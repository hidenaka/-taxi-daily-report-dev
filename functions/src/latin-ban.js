// functions/src/latin-ban.js
// 地名セルの「英字禁止」再読み取り。
//
// 認識モデル（PP-OCRv5）は日本語・数字・英字を同じ候補集合で扱う。つぶれた漢字が
// 英字として最有力になると、そのまま英字が出る（実例: 馬込→J、佃→a、清澄→ie）。
// 地名にアルファベットは絶対に出ないので、
//   1. 地名らしいセル（区/市 を含む）に英字が混ざったものを見つけ、
//   2. そのセルの切り抜きを2倍に拡大し、
//   3. 復号時に英字クラスを選ばないようにして読み直す。
// 復号（CTC greedy）はライブラリの JS 実装と同じ規則で、argmax の候補から
// 禁止クラスを除くだけ。モデル本体には手を入れない。
//
// 読み直した結果はそのまま確定させず confidence を低く付け直す（黄色のまま）。
// 誤読を別の誤読で上書きして黙って確定する事故を防ぐ。地名辞書で一意に補正
// できた場合だけ、下流の place-correct が通常どおり信頼を回復させる。

// 半角/全角の英字（地名には現れない）
const LATIN_RE = /[A-Za-zＡ-Ｚａ-ｚ]/;

/**
 * 辞書のうち英字クラスの index 集合を返す。
 * @param {string[]} dict 復号辞書（blank 済み・素のどちらでも可）
 * @returns {Set<number>}
 */
export function bannedLatinIndices(dict) {
  const banned = new Set();
  for (let i = 0; i < dict.length; i++) {
    const ch = dict[i];
    if (ch && ch.length === 1 && LATIN_RE.test(ch)) banned.add(i);
  }
  return banned;
}

/**
 * CTC greedy 復号（ライブラリ base-recognition.service の ctcGreedyDecode と
 * 同じ規則）に「禁止クラス」を足したもの。禁止クラスは argmax の候補から外す。
 * @param {Float32Array|number[]} logits [seq, numClasses] を平坦化した配列
 * @param {number} sequenceLength
 * @param {number} numClasses
 * @param {string[]} charDict blank(先頭空文字) 込みの辞書
 * @param {Set<number>} banned 選ばないクラス index
 * @returns {{text:string, confidence:number}}
 */
export function maskedCtcDecode(logits, sequenceLength, numClasses, charDict, banned) {
  const BLANK = 0;
  const dictLen = charDict.length;
  let text = "";
  let lastIndex = -1;
  let confSum = 0;
  let confCount = 0;
  for (let t = 0; t < sequenceLength; t++) {
    const base = t * numClasses;
    let maxProb = -Infinity;
    let maxIndex = BLANK;
    for (let c = 0; c < numClasses; c++) {
      if (banned.has(c)) continue;
      const p = logits[base + c] ?? -Infinity;
      if (p > maxProb) { maxProb = p; maxIndex = c; }
    }
    if (maxIndex === BLANK || maxIndex === lastIndex) {
      lastIndex = maxIndex;
      continue;
    }
    if (maxIndex < dictLen) {
      text += charDict[maxIndex] ?? "";
      confSum += maxProb;
      confCount++;
    }
    lastIndex = maxIndex;
  }
  return { text, confidence: confCount > 0 ? confSum / confCount : 0 };
}

/**
 * このセルは英字禁止で読み直すべきか。
 * 「区/市 を含む（＝地名らしい）」かつ「英字が混ざっている」ときだけ true。
 * 備考（ネット決済 ETC）や見出し（営Km）、日時セルの英字は正当なので触らない。
 * @param {string} text
 * @returns {boolean}
 */
export function needsLatinRescue(text) {
  const t = String(text || "");
  return /[区市]/.test(t) && LATIN_RE.test(t);
}

/**
 * 英字が混ざった地名 box を、英字禁止の復号で読み直す（box.text を書き換える）。
 *
 * @param {Array<{text:string,bbox:number[],confidence:number}>} boxes OCR結果
 * @param {object} canvas 前処理済みの全体 canvas
 * @param {object} service ppu-paddle-ocr の PaddleOcrService（initialize 済み）
 * @param {string[]} rawDict ppocrv5_dict.txt を行分割した素の辞書
 * @param {(w:number,h:number)=>object} createCanvas canvas 生成関数
 * @returns {Promise<Array<{before:string, after:string}>>} 書き換えたセルの記録
 */
export async function rescueLatinPlaceBoxes(boxes, canvas, service, rawDict, createCanvas) {
  const rec = service && service.recognitor;
  if (!rec || !Array.isArray(rawDict) || !rawDict.length) return [];

  const changed = [];
  for (const box of boxes) {
    if (!needsLatinRescue(box.text)) continue;
    try {
      const [x0, y0, x1, y1] = box.bbox;
      // 少し余白を付けて2倍に拡大して切り出す（小さい字の再認識精度を上げる）
      const pad = 3;
      const sx = Math.max(0, x0 - pad);
      const sy = Math.max(0, y0 - pad);
      const sw = Math.min(canvas.width, x1 + pad) - sx;
      const sh = Math.min(canvas.height, y1 + pad) - sy;
      if (sw < 4 || sh < 4) continue;
      const scale = 2;
      const crop = createCanvas(sw * scale, sh * scale);
      crop.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);

      // ライブラリと同じ前処理・推論を使い、復号だけ英字禁止版に差し替える
      const { imageTensor, tensorWidth, tensorHeight } = await rec.preprocessImage(crop);
      const inputTensor = new rec.platform.ort.Tensor(
        "float32", imageTensor, [1, 3, tensorHeight, tensorWidth],
      );
      let out;
      try {
        out = await rec.runInference(inputTensor);
      } finally {
        inputTensor.dispose?.();
      }
      const numClasses = out.dims[2];
      // decodeResults と同じ辞書合わせ: クラス数より1短ければ blank を先頭に足す
      const dict = rawDict.length === numClasses - 1 ? ["", ...rawDict] : rawDict;
      const banned = bannedLatinIndices(dict);
      const r = maskedCtcDecode(out.data, out.dims[1], numClasses, dict, banned);

      const newText = String(r.text || "").trim();
      // 読み直しが空・英字残り（辞書合わせ失敗等）なら元のまま
      if (!newText || LATIN_RE.test(newText)) continue;
      if (newText === box.text) continue;
      changed.push({ before: box.text, after: newText });
      box.text = newText;
      // 確定させない: 低信頼のまま黄色でレビューに回す。
      // 地名辞書で一意に補正できれば place-correct 側で信頼が回復する。
      box.confidence = Math.min(box.confidence ?? 0, 0.5);
    } catch {
      // 再読み取りは救済であり、失敗しても元の結果を壊さない
    }
  }
  return changed;
}

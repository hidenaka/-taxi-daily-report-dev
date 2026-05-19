// functions/src/header-ocr.js
// 営業明細ヘッダー（処理日付・出庫日時・入庫日時・走行KM）の読み取り。
// 表OCRパイプラインとは独立。生画像を正立回転し、上部帯を拡大してOCRする。
// 画像・canvas はすべてメモリ上のみ。ディスクに保存しない。

// ラベルboxの近傍下方から値boxを1つ選ぶ。
// label の下辺からの y差 [minDy,maxDy]、x中心差 |dx| < maxDx の範囲で、
// pickValue(text) が非nullを返す最初の（最も近い）boxの結果を返す。
// 基準にラベル下辺(bbox[3])を使うのは、ラベルが高い場合に自身の隣のboxを
// 誤って値として拾わないため。
function valueBelow(boxes, label, { minDy, maxDy, maxDx }, pickValue) {
  const lx = (label.bbox[0] + label.bbox[2]) / 2;
  const ly = label.bbox[3];
  const cands = [];
  for (const b of boxes) {
    if (b === label) continue;
    const bx = (b.bbox[0] + b.bbox[2]) / 2;
    const dy = b.bbox[1] - ly;
    if (dy < minDy || dy > maxDy) continue;
    if (Math.abs(bx - lx) > maxDx) continue;
    const v = pickValue(b.text);
    if (v != null) cands.push({ v, dy });
  }
  cands.sort((a, b) => a.dy - b.dy);
  return cands.length ? cands[0].v : null;
}

// テキストから日付 YYYY/MM/DD を ISO YYYY-MM-DD に。
function pickDate(text) {
  const m = String(text).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// テキストから時刻 HH:MM を抽出（"5/1007:07" のような結合でも末尾の時刻を取る）。
function pickTime(text) {
  const all = String(text).match(/(\d{1,2}):(\d{2})/g);
  if (!all || !all.length) return null;
  const m = all[all.length - 1].match(/(\d{1,2}):(\d{2})/);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// テキストが純粋な整数なら数値に。
function pickInt(text) {
  const t = String(text).trim();
  if (!/^-?\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * ヘッダー帯のOCRボックス配列からヘッダー値を抽出する純粋関数。
 * @param {Array<{text:string,bbox:number[],confidence:number}>} boxes
 * @returns {{date:?string, departTime:?string, returnTime:?string, totalKm:?number}}
 */
export function parseHeaderBoxes(boxes) {
  const result = { date: null, departTime: null, returnTime: null, totalKm: null };
  if (!Array.isArray(boxes)) return result;

  const find = (pred) => boxes.find((b) => pred(String(b.text)));

  const dateLabel = find((t) => t.includes("処理") && t.includes("日付"));
  if (dateLabel) {
    result.date = valueBelow(boxes, dateLabel, { minDy: 30, maxDy: 160, maxDx: 250 }, pickDate);
  }

  const departLabel = find((t) => t.includes("出庫"));
  if (departLabel) {
    result.departTime = valueBelow(boxes, departLabel, { minDy: 30, maxDy: 160, maxDx: 300 }, pickTime);
  }

  const returnLabel = find((t) => t.includes("入庫"));
  if (returnLabel) {
    result.returnTime = valueBelow(boxes, returnLabel, { minDy: 30, maxDy: 160, maxDx: 300 }, pickTime);
  }

  // 走行KM: 「走行」かつ「KM/Km/ＫＭ」を含むラベル（「走行時間」「実車KM」を除外）。
  const kmLabel = find((t) => t.includes("走行") && /K[Mm]|ＫＭ/.test(t));
  if (kmLabel) {
    result.totalKm = valueBelow(boxes, kmLabel, { minDy: 30, maxDy: 160, maxDx: 230 }, pickInt);
  }

  return result;
}

// js/ocr/src/place-correct.js
// ocr-spike/place-correct.js のブラウザ移植版（CommonJS → ESM。ロジックは同一）。
//
// OCR が読んだ地名（例「洪谷区篇谷町1」）を、東京の区＋町名辞書
// （data/tokyo-chome.json）にファジーマッチして補正する。
//
// OCR 単体では系統的誤読（渋→洪、鶯→篇 等）で地名が ~80% 止まり。
// 辞書の正規表記に編集距離で寄せることで完全一致率を引き上げる。
//
// correctPlace(raw, gazetteer) → { text, corrected, lowConfidence, raw }
//   text         … 補正後の地名（補正できなければ raw のまま）
//   corrected    … 辞書補正が効いたか
//   lowConfidence… しきい値外で確信が持てない（レビュー対象）

// --- 編集距離（Levenshtein） ---
function editDistance(a, b) {
  a = String(a || '');
  b = String(b || '');
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// 辞書中の候補から raw に最も近いものを返す。
//   { match, dist, ratio }  ratio = dist / max(len) （0=完全一致）
function nearest(raw, candidates) {
  let best = null, bd = Infinity;
  for (const c of candidates) {
    const d = editDistance(raw, c);
    if (d < bd) { bd = d; best = c; }
    if (d === 0) break;
  }
  if (best == null) return null;
  const ratio = bd / Math.max(raw.length, best.length, 1);
  return { match: best, dist: bd, ratio };
}

// 区名（市区町村名）の境界を見つけ、[区, 残り] に分解する。
// 東京23区＋市部。区名は 区/市/町/村 で終わる。
// OCR 誤読で末尾文字が崩れることもあるため、まず辞書の区名と
// 前方一致を試し、ダメなら最初の 区/市/町/村 で切る。
function splitWard(raw, wards) {
  const s = String(raw || '').trim();
  // 1) 辞書の区名で前方一致（最長一致を優先）
  let bestW = null;
  for (const w of wards) {
    if (s.startsWith(w) && (!bestW || w.length > bestW.length)) bestW = w;
  }
  if (bestW) return { ward: bestW, rest: s.slice(bestW.length), wardExact: true };
  // 2) 区/市/町/村 の最初の出現で切る（先頭付近のもの）。
  //    町名末尾の "町"（例 鶯谷町）で切らないよう、位置 5 文字以内に限る。
  const m = s.slice(0, 6).match(/[区市町村]/);
  if (m) {
    const at = m.index + 1;
    return { ward: s.slice(0, at), rest: s.slice(at), wardExact: false };
  }
  return { ward: '', rest: s, wardExact: false };
}

// 町名部分から末尾の丁目数字（半角/全角/漢数字）を切り離す。
const TRAIL_NUM = /[0-9０-９一二三四五六七八九十〇零]+$/;
function splitTownNumber(rest) {
  const s = String(rest || '').trim();
  const m = s.match(TRAIL_NUM);
  if (m) {
    return { town: s.slice(0, s.length - m[0].length), num: m[0] };
  }
  return { town: s, num: '' };
}

// 丁目数字を半角アラビア数字へ。漢数字も変換。
const KANJI_NUM = { '〇': '0', '零': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
function normNumber(num) {
  if (!num) return '';
  let s = String(num).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (/^[0-9]+$/.test(s)) return s;
  // 漢数字（"四" / "十" など単純なもののみ）
  if (s === '十') return '10';
  let out = '';
  for (const ch of s) out += KANJI_NUM[ch] != null ? KANJI_NUM[ch] : ch;
  return out;
}

// 補正のしきい値。これより ratio が大きい（＝似ていない）と低信頼。
// 区名は3文字中1誤読、町名は短語(2文字)で1誤読まで許容したいので
// ratio 0.5 を上限とする（系統的誤読「渋→洪」が "洪谷"→"渋谷" で
// dist=1/len=2 になるため）。誤マッチ防止に、許容するのは
// 「dist が小さい（1〜2文字差）」場合に限る（下の correctPlace 参照）。
const WARD_RATIO_MAX = 0.5;   // 区名
const TOWN_RATIO_MAX = 0.5;   // 町名
const TOWN_DIST_MAX = 2;      // 町名の絶対編集距離上限（長い町名の暴発防止）

// OCR地名を辞書に寄せて補正する。
function correctPlace(raw, gazetteer) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return { text: '', corrected: false, lowConfidence: false, raw: original };
  if (!gazetteer || !gazetteer.wards) {
    return { text: original, corrected: false, lowConfidence: false, raw: original };
  }

  const { ward, rest } = splitWard(original, gazetteer.wards);
  if (!ward) {
    // 区が取れない → 補正不能。原文を低信頼で返す。
    return { text: original, corrected: false, lowConfidence: true, raw: original };
  }

  // 区名を辞書へ最近傍マッチ
  const wHit = nearest(ward, gazetteer.wards);
  if (!wHit || wHit.ratio > WARD_RATIO_MAX) {
    return { text: original, corrected: false, lowConfidence: true, raw: original };
  }
  const fixedWard = wHit.match;

  // 町名＋丁目数字に分解
  const { town, num } = splitTownNumber(rest);
  const numOut = normNumber(num);

  // 町名なし（区のみ）の地名はそのまま
  if (!town) {
    const text = fixedWard + numOut;
    const corrected = fixedWard !== ward;
    return { text, corrected, lowConfidence: false, raw: original };
  }

  const townList = (gazetteer.towns && gazetteer.towns[fixedWard]) || [];
  const tHit = townList.length ? nearest(town, townList) : null;

  let fixedTown = town;
  let townOk = false;
  if (tHit && tHit.ratio <= TOWN_RATIO_MAX && tHit.dist <= TOWN_DIST_MAX) {
    fixedTown = tHit.match;
    townOk = true;
  }

  const text = fixedWard + fixedTown + numOut;
  const corrected = text !== original && (fixedWard !== ward || fixedTown !== town);
  // 町名が辞書に寄せられなかった場合は低信頼（レビュー対象）。
  const lowConfidence = !townOk;
  return { text, corrected, lowConfidence, raw: original };
}

export { correctPlace, editDistance };
export const _internal = { splitWard, splitTownNumber, nearest };

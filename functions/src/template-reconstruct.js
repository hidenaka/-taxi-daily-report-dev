// js/ocr/src/template-reconstruct.js
// 固定テンプレート方式の営業明細復元。
//
// ocr-spike/template-reconstruct.js のブラウザ移植版（CommonJS → ESM）。
// ロジックはハーネス版と完全に一致させること
// （決定論的なため同一入力で同一の rows を返す）。
//
// === なぜテンプレート方式か ===
// 先行5アプローチ（OCRボックス・クラスタリング×3 / モルフォロジー罫線検出 /
// RT-DETR 学習セル検出）は全て「グリッドを推論・検出」しようとして過適合 or 破綻した。
//
// 営業明細は恵豊自動車交通の固定印刷フォーム。16列構造・行ピッチは常に一定。
// 画像ごとの違いは前処理由来の一様アフィン変換のみ（A,B のヘッダー列中心は
// B = 1.497*A - 849 に残差7px以内で乗る）。
//
// よってグリッドを推論しない:
//   1. keiho-template.json … 16列の x 分率・行ピッチ分率（基準画像Aから1回測定・固定）
//   2. 画像ごと: ヘッダーラベル box を検出 → テンプレ列順との 1D アフィン
//      pixel = a + b*frac を頑健フィット（外れ値除去）。これがテーブル領域の特定。
//   3. y は同じスケール b を流用し、header.y で原点を合わせ rowY0/pitch を確定。
//   4. 各 OCR box の中心を固定グリッドに point-in-grid で引き当てる（クラスタリング無し）。
//   5. START/END 列グループのオフセット補正:
//        エントリ K = grid行 R の START 列 + grid行 R-1 の END 列
//   6. kanji-normalize / place-correct でテキストセルを補正し {rows} を出力。
//
// 注: ハーネス版は findHeaderRow / finalizeRow / KEIHO_COLUMNS / HEADER_ALIASES を
//     ハーネスの grid-reconstruct.js / keiho-columns.js から require していた。
//     アプリ側では grid-reconstruct.js を廃止するため、それらヘルパを本ファイルへ
//     インライン移植する（ハーネス版と同一ロジック）。

import { normalizeKanji } from "./kanji-normalize.js";
import { correctPlace } from "./place-correct.js";
// 地名辞書（東京 区＋町名）。Node ESM の JSON import 属性で読み込む。
import GAZETTEER from "../data/tokyo-chome.json" with { type: "json" };
// 16列の x 分率・行ピッチ分率（基準画像Aから1回測定・固定）。
import TEMPLATE from "../data/keiho-template.json" with { type: "json" };

// =============================================================================
// 恵豊様式・営業明細の列定義（旧 ocr-spike/keiho-columns.js）
//
// type:
//   int     … 整数（No / 男 / 女）。ただし No は "休" 等の文字も入る特例扱い
//   time    … 時刻（乗車 / 降車 / 時間）。H:MM へ正規化
//   decimal … 小数（営Km）。NN.N へ正規化
//   fare    … 金額（合計 / 料金 / 現収 / 未収 / 立替）。カンマ除去し整数へ
//   flag    … 真偽（迎）。それらしき文字があれば "迎"
//   text    … 自由文（乗車地 / 降車地 / 備考）
//
// group:
//   start … 物理行の左クラスタ（No〜乗車地）。明細エントリ K の入力時に印字
//   end   … 物理行の右クラスタ（降車地〜備考）。取引終了時に印字されるため
//           エントリ K の END データはエントリ K の START 行の「1つ上」の
//           物理行に出る。本ファイルがこの食い違いを補正して結線する。
// =============================================================================

const KEIHO_COLUMNS = [
  { name: 'No',    type: 'int',     group: 'start' },
  { name: '乗車',  type: 'time',    group: 'start' },
  { name: '降車',  type: 'time',    group: 'start' },
  { name: '時間',  type: 'time',    group: 'start' },
  { name: '迎',    type: 'flag',    group: 'start' },
  { name: '乗車地', type: 'text',    group: 'start' },
  { name: '降車地', type: 'text',    group: 'end'   },
  { name: '営Km',  type: 'decimal', group: 'end'   },
  { name: '男',    type: 'int',     group: 'end'   },
  { name: '女',    type: 'int',     group: 'end'   },
  { name: '合計',  type: 'fare',    group: 'end'   },
  { name: '料金',  type: 'fare',    group: 'end'   },
  { name: '現収',  type: 'fare',    group: 'end'   },
  { name: '未収',  type: 'fare',    group: 'end'   },
  { name: '立替',  type: 'fare',    group: 'end'   },
  { name: '備考',  type: 'text',    group: 'end'   },
];

// ヘッダー行検出に使う「列名 box の表記ゆれ」マップ。
// OCR は同義／崩れた字を返すので、検出時はこの候補集合で当てる。
// 値は正規化後の列名。
const HEADER_ALIASES = {
  'No': 'No', 'No.': 'No', 'N.': 'No', 'N0': 'No', 'no': 'No',
  '乗車': '乗車', '麟車': '乗車', '乘車': '乗車',
  '降車': '降車', '降单': '降車',
  '時間': '時間',
  '迎': '迎', '週': '迎', '迅': '迎',
  '乗車地': '乗車地', '降車地': '降車地',
  '営Km': '営Km', 'Km': '営Km', '営km': '営Km',
  '営KM': '営Km', '営Ｋｍ': '営Km', '掌Km': '営Km', '宮Km': '営Km',
  '営Krn': '営Km', '営km.': '営Km', '営Ｋｍ.': '営Km',
  '男': '男', '女': '女',
  '合計': '合計', '料金': '料金', '現収': '現収',
  '未収': '未収', '立替': '立替', '立巻': '立替',
  '備考': '備考',
};

// 地名（乗車地/降車地）に辞書ファジーマッチ補正をかける列名。
const PLACE_COLS = new Set(['乗車地', '降車地']);

// ---- box ヘルパ ------------------------------------------------------------
const cx = (b) => (b.bbox[0] + b.bbox[2]) / 2;
const cy = (b) => (b.bbox[1] + b.bbox[3]) / 2;
const txt = (b) => String(b.text || '').trim();
// 全角数字→半角（No セル判定用）
const toHalfDigits = (s) =>
  String(s || '').replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );

// =============================================================================
// ヘッダー検出（旧 ocr-spike/grid-reconstruct.js より移植）
// =============================================================================

// 列名 box のテキストを正規化列名へ。当たらなければ null。
export function matchHeaderLabel(text) {
  const t = String(text || '').trim();
  if (HEADER_ALIASES[t]) return HEADER_ALIASES[t];
  // 「地」で終わる語は 乗車地 / 降車地 のどちらか。異体字誤読（例: "乘車地"）が
  // 部分一致で時刻列の 乗車 / 降車 に化けると、その1点が x 軸アフィンを壊して
  // 16列すべてがずれる（IMG_1523 で実証）。どちらか確定できないなら当てない。
  const endsWithChi = /地$/.test(t);
  // 前後ノイズ保険: エイリアスが先頭/末尾に来る場合のみ部分一致を許す。
  for (const [alias, name] of Object.entries(HEADER_ALIASES)) {
    if (alias.length < 2) continue;
    if (endsWithChi && !/地$/.test(alias)) continue;
    if (t.length > alias.length + 4) continue; // 長すぎる連結は表外見出し
    if (t.startsWith(alias) || t.endsWith(alias)) {
      // "休憩時間"→"時間" のような「別漢字＋列名」複合語は表外見出しとして除外。
      const aliasIsKanji = /[一-鿿]/.test(alias);
      if (
        aliasIsKanji &&
        t.endsWith(alias) &&
        t.length > alias.length &&
        /[一-鿿]/.test(t.slice(0, t.length - alias.length))
      ) {
        continue;
      }
      return name;
    }
  }
  return null;
}

// 営業明細のヘッダー行を見つける。
// ヘッダー語に一致する box が同じ y 帯に複数並ぶ箇所を探す。
// 上部サマリーや ETC 明細のヘッダーと混同しないよう、
// 「降車地・乗車地・営Km・合計 等の本表特有の列名」が多く揃う帯を選ぶ。
// 戻り値: { y, top, bottom, boxes:[{name,x,y,box}], labelBoxes:Set }
function findHeaderRow(boxes) {
  const labeled = [];
  for (const b of boxes) {
    const name = matchHeaderLabel(b.text);
    if (name) labeled.push({ box: b, name, x: cx(b), y: cy(b) });
  }
  if (!labeled.length) return null;

  // y で近いものを帯にまとめる。ヘッダーラベルは y が staggered なので広め。
  labeled.sort((a, b) => a.y - b.y);
  const TOL = 110;
  const bands = [];
  for (const l of labeled) {
    let band = bands.find((bd) => Math.abs(bd.yMean - l.y) <= TOL);
    if (!band) {
      band = { items: [], yMean: l.y };
      bands.push(band);
    }
    band.items.push(l);
    band.yMean = band.items.reduce((s, it) => s + it.y, 0) / band.items.length;
  }

  // 明細表ヘッダーに特有な列名（上部サマリーには出ない）
  const CORE = new Set(['乗車地', '降車地', '営Km', '合計', '乗車', '降車', '時間', 'No']);
  let best = null;
  for (const band of bands) {
    const names = new Set(band.items.map((it) => it.name));
    const coreHits = [...names].filter((n) => CORE.has(n)).length;
    const score = coreHits * 10 + names.size;
    if (coreHits >= 3 && (!best || score > best.score)) {
      best = { band, score };
    }
  }
  if (!best) return null;

  // CORE 列ラベルの y 中央値を真のヘッダー行 y とする。
  const coreY = best.band.items
    .filter((it) => CORE.has(it.name))
    .map((it) => it.y)
    .sort((a, b) => a - b);
  const medY = coreY.length ? coreY[Math.floor(coreY.length / 2)] : best.band.yMean;

  // 1 列名につき 1 box。同名複数なら真の行 y に最も近いものを採る。
  const byName = new Map();
  for (const it of best.band.items) {
    const prev = byName.get(it.name);
    if (!prev || Math.abs(it.y - medY) < Math.abs(prev.y - medY)) {
      byName.set(it.name, it);
    }
  }
  const headerBoxes = [...byName.values()].map((it) => ({
    name: it.name,
    x: it.x,
    y: it.y,
    box: it.box,
  }));

  // ヘッダー行の上端/下端 y。
  // headerBottom を max で取ると、1個のラベル box が縦長に誤検出された場合
  // （例: "No" が行罫線まで含み下端が伸びる）にそれへ引っ張られ、明細表の
  // 1行目の START 列を「ヘッダー内」と誤判定して丸ごとカットしてしまう。
  // ラベル下端の中央値で頑健に取る（外れ値1個に影響されない）。
  const headerTop = Math.min(...headerBoxes.map((hb) => hb.box.bbox[1]));
  const sortedBottoms = headerBoxes.map((hb) => hb.box.bbox[3]).sort((a, b) => a - b);
  const headerBottom = sortedBottoms[Math.floor(sortedBottoms.length / 2)];
  // 明細領域から除外すべきヘッダーラベル box の集合（参照同一性で判定）。
  // END グループの最初の行はヘッダーと同じ y 帯に印字されるため、
  // y カットではなくヘッダー box そのものを名指しで除外する。
  const labelBoxes = new Set(headerBoxes.map((hb) => hb.box));
  return {
    y: medY,
    top: headerTop,
    bottom: headerBottom,
    boxes: headerBoxes,
    labelBoxes,
  };
}

// =============================================================================
// セル正規化 / finalizeRow（旧 ocr-spike/grid-reconstruct.js より移植）
// =============================================================================

// 全角数字・記号を半角へ
const Z2H = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  'Ｏ': '0', 'ｏ': '0', 'O': '0', 'o': '0', 'Ｉ': '1', 'ｌ': '1',
  '：': ':', '．': '.', '，': ',', '　': ' ',
};
function toHalf(s) {
  return String(s || '').replace(/[０-９ＯｏOoＩｌ：．，　]/g, (c) => Z2H[c] || c);
}

// 信頼度しきい値（これ未満の box 由来セルは低信頼）
const CONF_THRESHOLD = 0.55;

// セルの生テキストを列 type で正規化する。戻り値 { text, lowConfidence }
export function normalizeCell(rawText, type, confidence) {
  const raw = toHalf(rawText).trim();
  let text = raw;
  let lowConfidence = false;

  if (type === 'time') {
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 3 && digits.length <= 4) {
      const mm = digits.slice(-2);
      const hh = digits.slice(0, -2);
      text = `${parseInt(hh, 10)}:${mm}`;
    } else if (digits.length === 2) {
      text = `0:${digits}`;
    } else if (digits.length === 1) {
      text = `0:0${digits}`;
      lowConfidence = true;
    } else {
      text = '';
      if (raw) lowConfidence = true;
    }
  } else if (type === 'decimal') {
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 2) {
      const d1 = digits.slice(-1);
      const intp = digits.slice(0, -1);
      text = `${parseInt(intp, 10)}.${d1}`;
    } else if (digits.length === 1) {
      text = `0.${digits}`;
    } else {
      text = '';
    }
  } else if (type === 'fare') {
    const digits = raw.replace(/[^0-9]/g, '');
    text = digits ? String(parseInt(digits, 10)) : '';
  } else if (type === 'int') {
    const digits = raw.replace(/[^0-9]/g, '');
    // 貸切マーカー「貸1」等は接頭辞「貸」を保持する(数字だけに切り詰めると
    // 下流 to-drive の isCharter 判定が外れ貸切が消える)。休と同じ特例扱い。
    if (/貸/.test(raw)) {
      text = digits ? `貸${parseInt(digits, 10)}` : '貸';
    } else if (digits) {
      text = String(parseInt(digits, 10));
    } else if (/[休保㈱]/.test(raw)) {
      text = '休';
    } else {
      text = raw || '';
    }
  } else if (type === 'flag') {
    text = /[迎連週迅]/.test(raw) ? '迎' : '';
  } else {
    // text（乗車地 / 降車地 / 備考）。PP-OCRv5 の簡体字字形を常用漢字へ。
    text = normalizeKanji(raw);
  }

  if (confidence != null && confidence < CONF_THRESHOLD) lowConfidence = true;
  if (!text && rawText && String(rawText).trim()) lowConfidence = true;
  return { text, lowConfidence };
}

// エントリの START/END box 集合（{col:[box]}）から 1 行の構造データを作る。
// 戻り値: { No, 乗車, ..., 備考, _flags, _raw, _corrected? }
function finalizeRow(entry, columns) {
  const row = {};
  const flags = {};
  const raw = {};

  // 列ごとに box を集め、x 順で連結したセルテキストを得る。
  const cellOf = (colName, group) => {
    const bucket = group === 'start' ? entry.start : entry.end;
    const bs = bucket[colName];
    if (!bs || !bs.length) return { text: '', confidence: null };
    const sorted = bs.slice().sort((a, b) => cx(a) - cx(b));
    const text = sorted.map(txt).join(' ').trim();
    const conf = sorted.reduce((s, b) => s + (b.confidence || 0), 0) / sorted.length;
    return { text, confidence: conf };
  };

  for (const col of columns) {
    const cell = cellOf(col.name, col.group);
    const norm = normalizeCell(cell.text, col.type, cell.confidence);
    let value = norm.text;
    let low = norm.lowConfidence;

    if (PLACE_COLS.has(col.name) && GAZETTEER && value) {
      const cp = correctPlace(value, GAZETTEER);
      value = cp.text;
      if (cp.lowConfidence) low = true;
      if (cp.corrected) {
        if (!row._corrected) row._corrected = {};
        row._corrected[col.name] = true;
      }
    }

    row[col.name] = value;
    raw[col.name] = cell.text;
    if (low) flags[col.name] = true;
  }

  row._flags = flags;
  row._raw = raw;
  return row;
}

// =============================================================================
// テンプレート方式の復元本体
// =============================================================================

// 1D 頑健アフィンフィット: 点 (frac_i, px_i) に px = a + b*frac を当てる。
// 最小二乗 → 残差 MAD で外れ値を落とし → 再フィット（簡易 RANSAC）。
function robustAffine(points) {
  let pts = points.slice();
  function fit(P) {
    const n = P.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of P) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const b = (n * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / n;
    return { a, b };
  }
  let m = fit(pts);
  if (!m) return null;
  // 2回まで外れ値除去
  for (let iter = 0; iter < 2; iter++) {
    const resid = pts.map(([x, y]) => Math.abs(y - (m.a + m.b * x)));
    const sorted = [...resid].sort((p, q) => p - q);
    const med = sorted[Math.floor(sorted.length / 2)];
    // MAD ベースのしきい値。最低 12px は許容（OCR中心ゆらぎ）。
    const thr = Math.max(med * 3, 12);
    const kept = pts.filter((_, i) => resid[i] <= thr);
    if (kept.length === pts.length || kept.length < 4) break;
    pts = kept;
    m = fit(pts) || m;
  }
  return { a: m.a, b: m.b, inliers: pts.length };
}

// =============================================================================
// 見出し行に頼らない表の特定（フォールバック）
// =============================================================================
//
// 見出し行の文字（No/乗車/降車/…）は本文より小さく、写真がぼけると真っ先に潰れる。
// 見出しが読めないと表の位置が決まらず、本文が読めていても丸ごと落ちていた
// （LINE 経由で圧縮された写真＝約164万画素、で実証。本文は82%が高信頼なのに0件）。
//
// そこで見出しが取れないときは、本文の「どの列に何が入るか」で枠を当てる。
// 明細表は列ごとに中身の種類が決まっている:
//   時刻→乗車/降車/時間、地名→乗車地/降車地、小数→営Km、金額→合計〜立替、備考→決済種別。
// 各 box を種類分けし、x 軸アフィン (a,b) を走査して「種類と列が合う box の割合」を
// 最大化する。幾何（列の隙間・表の左右端）だけでは OCR の box が列境界をまたぐため
// 決まらないが、中身の種類を使うと決まる（実測: 幅の誤差 0.8〜2.4%）。

// 列 index: 0 No / 1 乗車 / 2 降車 / 3 時間 / 4 迎 / 5 乗車地 / 6 降車地 / 7 営Km
//           8 男 / 9 女 / 10 合計 / 11 料金 / 12 現収 / 13 未収 / 14 立替 / 15 備考
const BODY_KIND_COLUMNS = {
  time: new Set([1, 2, 3]),
  place: new Set([5, 6]),
  decimal: new Set([7]),
  money: new Set([10, 11, 12, 13, 14]),
  flag: new Set([4]),
  note: new Set([15]),
};

// box のテキストから中身の種類を判定する。判定できなければ null（採点に使わない）。
function classifyBodyCell(text) {
  const t = toHalfDigits(String(text || '').trim());
  if (!t) return null;
  if (/[区市]/.test(t) && t.length >= 4) return 'place';
  if (/決済|決斉|チケット|ETC|Visa|QuickPay|AMEX|交通|遠割/i.test(t)) return 'note';
  if (/^[迎連週迅]$/.test(t)) return 'flag';
  if (/^\d{1,2}[:：.\-]\d{2}$/.test(t)) return 'time';
  const digits = t.replace(/[^0-9]/g, '');
  if (digits.length === 4 && /^[0-9:：.\-]+$/.test(t)) return 'time';
  if (/^\d{1,2}[.]\d$/.test(t)) return 'decimal';
  if (/^[0-9,.]+$/.test(t) && digits.length >= 3 && digits.length <= 6) return 'money';
  return null;
}

// 本文 box から x 軸アフィンと表の y 帯を推定する。取れなければ null。
export function fitGridFromBody(boxes) {
  const isPlace = (b) => /[区市]/.test(txt(b)) && txt(b).length >= 4;
  const pick = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p)))];
  const placeYs = boxes.filter(isPlace).map(cy).sort((p, q) => p - q);
  if (placeYs.length < 8) return null;               // 地名が少なすぎる＝明細表ではない

  // 明細表の y 帯を取る。上部サマリーにも地名（乗務開始場所）が数個あるので、
  // 「等間隔に密集している最大の塊」だけを表とみなす。塊から離れた地名は捨てる。
  const gaps = [];
  for (let i = 1; i < placeYs.length; i++) gaps.push(placeYs[i] - placeYs[i - 1]);
  const medGap = [...gaps].sort((p, q) => p - q)[Math.floor(gaps.length / 2)] || 1;
  const maxGap = Math.max(medGap * 4, 40);
  let bestRun = { s: 0, e: 0 }, runStart = 0;
  for (let i = 1; i <= placeYs.length; i++) {
    if (i === placeYs.length || placeYs[i] - placeYs[i - 1] > maxGap) {
      if (i - runStart > bestRun.e - bestRun.s) bestRun = { s: runStart, e: i };
      runStart = i;
    }
  }
  const band = placeYs.slice(bestRun.s, bestRun.e);
  if (band.length < 8) return null;
  const yLo = pick(band, 0.02), yHi = pick(band, 0.98);

  const items = [];
  for (const b of boxes) {
    const yc = cy(b);
    if (yc < yLo - 30 || yc > yHi + 30) continue;
    const kind = classifyBodyCell(b.text);
    if (kind) items.push({ xl: b.bbox[0], xr: b.bbox[2], kind });
  }
  if (items.length < 40) return null;

  const xls = items.map((i) => i.xl).sort((p, q) => p - q);
  const xrs = items.map((i) => i.xr).sort((p, q) => p - q);

  // 探索範囲は本文の広がりから決める（画像サイズに依存させない）。
  const span = pick(xrs, 0.98) - pick(xls, 0.02);
  const bCenter = span / (TEMPLATE.colBoundFrac[16] - TEMPLATE.colBoundFrac[0]);
  const aCenter = pick(xls, 0.02) - bCenter * TEMPLATE.colBoundFrac[0];

  // 種類ごとに重みを均す。時刻3列・金額5列・地名2列は「1列ずらしても型が合う」ため、
  // 数の多い種類に任せると1列ずれた解に落ちる。1列しかない 迎・営Km・備考 は
  // ずれを一意に決められるので、数が少なくても同じだけ効かせる。
  const perKind = {};
  for (const it of items) perKind[it.kind] = (perKind[it.kind] || 0) + 1;
  const kinds = Object.keys(perKind);
  for (const it of items) it.w = 1 / perKind[it.kind];
  const totalW = kinds.length;

  const score = (a, b) => {
    const bounds = TEMPLATE.colBoundFrac.map((f) => a + b * f);
    let ok = 0;
    for (const it of items) {
      let best = -1, ov = 0;
      for (let i = 0; i < 16; i++) {
        const o = Math.min(it.xr, bounds[i + 1]) - Math.max(it.xl, bounds[i]);
        if (o > ov) { ov = o; best = i; }
      }
      if (best >= 0 && BODY_KIND_COLUMNS[it.kind].has(best)) ok += it.w;
    }
    // 枠の左右端が本文の広がりと合っているか（1列ずれの解を弱める）
    const edge =
      (Math.abs(bounds[0] - pick(xls, 0.02)) + Math.abs(bounds[16] - pick(xrs, 0.98))) / b;
    return ok / totalW - edge * 0.6;
  };

  // 粗探索 → 山登りで細部を詰める
  let best = null;
  const coarse = bCenter * 0.01;
  for (let b = bCenter * 0.7; b <= bCenter * 1.4; b += coarse) {
    for (let a = aCenter - bCenter * 0.2; a <= aCenter + bCenter * 0.2; a += coarse) {
      const s = score(a, b);
      if (!best || s > best.s) best = { a, b, s };
    }
  }
  for (const st of [bCenter * 0.003, bCenter * 0.001, bCenter * 0.0003]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [da, db] of [[st, 0], [-st, 0], [0, st], [0, -st], [st, st], [-st, -st], [st, -st], [-st, st]]) {
        const s = score(best.a + da, best.b + db);
        if (s > best.s + 1e-9) { best = { a: best.a + da, b: best.b + db, s }; improved = true; }
      }
    }
  }
  // 一致率が低いときは表と見なさない（誤検出で無意味な行を作らない）
  if (best.s < 0.5) return null;
  return { a: best.a, b: best.b, agreement: best.s, yTop: yLo, yBottom: yHi };
}

// ヘッダーラベル box 群を取得（最も明細表らしい y 帯を選ぶ）。
function locateTable(boxes) {
  const header = findHeaderRow(boxes);
  if (!header) return locateTableFromBody(boxes);

  // テンプレ列順 index に対する検出済みヘッダー中心 x の対応点
  const order = TEMPLATE.columns;
  const idxOf = {};
  order.forEach((n, i) => { idxOf[n] = i; });
  const points = [];
  for (const hb of header.boxes) {
    const i = idxOf[hb.name];
    if (i == null) continue;
    points.push([TEMPLATE.colCenterFrac[i], hb.x]);
  }
  if (points.length < 4) return locateTableFromBody(boxes);

  // x 軸アフィン: pixelX = ax + bx * frac。
  // これがテーブル領域の特定: 16 列の x ピクセル位置が一意に決まる。
  const xm = robustAffine(points);
  if (!xm) return locateTableFromBody(boxes);

  return { header, xm };
}

// 見出しが取れないときの表特定。fitGridFromBody で枠を求め、
// 本文の先頭行の少し上に「疑似ヘッダー」を置いて以降の処理をそのまま使う。
function locateTableFromBody(boxes) {
  const fit = fitGridFromBody(boxes);
  if (!fit) return null;
  const pitch = fit.b * TEMPLATE.pitchFrac;
  const y = fit.yTop - pitch;              // 見出し行があるはずの位置
  return {
    header: {
      y,
      top: y - pitch * 0.6,
      bottom: fit.yTop - pitch * 0.45,     // 本文1行目の直上で切る
      boxes: [],
      labelBoxes: new Set(),
    },
    xm: { a: fit.a, b: fit.b, inliers: 0 },
    fromBody: true,
    agreement: fit.agreement,
    // 明細表の下端。見出しが読めない写真では ETC明細 の見出し(預り金/会社負担)も
    // 読めず etcY カットが効かないため、地名の密集帯の下で切る。
    bodyBottom: fit.yBottom + pitch * 1.5,
  };
}

// テーブル座標系を組み立てる。
// テンプレ（固定）から:
//   - 16 列の境界 x / 中心 x  = アフィン xm でピクセルへ
//   - 行ピッチ pitch          = xm.b * pitchFrac
// 行 index は絶対座標から推論しない（先行アプローチが過適合した箇所）。
// pitch は行クラスタリングのギャップしきい値・位相探索の周期に使う。
function buildGrid(loc) {
  const { xm } = loc;
  const colBoundsPx = TEMPLATE.colBoundFrac.map((f) => xm.a + xm.b * f);
  const colCenterPx = TEMPLATE.colCenterFrac.map((f) => xm.a + xm.b * f);
  const pitch = xm.b * TEMPLATE.pitchFrac;
  return { colBoundsPx, colCenterPx, pitch };
}

// box 中心がどの列 index に入るか（固定境界の point-in-grid）。
function colIndexOf(xc, colBoundsPx) {
  if (xc < colBoundsPx[0] || xc > colBoundsPx[16]) {
    // 端の許容: 半セル分のはみ出しまでは端列に丸める
    const halfFirst = (colBoundsPx[1] - colBoundsPx[0]) / 2;
    const halfLast = (colBoundsPx[16] - colBoundsPx[15]) / 2;
    if (xc < colBoundsPx[0] && xc >= colBoundsPx[0] - halfFirst) return 0;
    if (xc > colBoundsPx[16] && xc <= colBoundsPx[16] + halfLast) return 15;
    return -1;
  }
  for (let i = 0; i < 16; i++) {
    if (xc >= colBoundsPx[i] && xc < colBoundsPx[i + 1]) return i;
  }
  return 15;
}

// box の x 区間 [xl,xr] が最も重なる列 index を返す。
// 数値 box は幅が狭く中心がはっきりするが、乗車地/降車地 のような幅広テキスト
// box は左寄せで中心が列境界をまたぐ。区間重なり最大で当てると両方に効く。
function colIndexByOverlap(xl, xr, colBoundsPx) {
  let best = -1, bestOv = 0;
  for (let i = 0; i < 16; i++) {
    const ov = Math.min(xr, colBoundsPx[i + 1]) - Math.max(xl, colBoundsPx[i]);
    if (ov > bestOv) { bestOv = ov; best = i; }
  }
  if (best >= 0 && bestOv > 0) return best;
  // 重なりゼロ: 中心で端許容にフォールバック
  return colIndexOf((xl + xr) / 2, colBoundsPx);
}

// box 集合の最適デスキュー傾き（y = ... + slope*x）を探索で求める。
// 印刷フォームは前処理後にわずかに回転し、さらに END 列群は固定の傾きを持つ。
// 傾きは画像ごとに違うので測定する。
//
// 指標: 行は等ピッチで並ぶので、正しい傾きでデスキューすると全 box の y は
// 「ピッチの整数倍 + 一定位相」に揃う。各 box の (デスキュー後 y) を pitch で
// 折り返した位相の集中度（circular variance）が最大になる傾きを採る。
// クラスタ数を直接見ないので「全 box バラバラ＝score 0」の退化に陥らない。
function findDeskewSlope(items, pitch) {
  if (items.length < 6) return 0;
  const TWO_PI = Math.PI * 2;
  let best = { s: 0, R: -1 };
  for (let s = -0.07; s <= 0.03; s += 0.0005) {
    let sumC = 0, sumS = 0;
    for (const it of items) {
      const phase = ((it.yc - s * it.xc) / pitch) * TWO_PI;
      sumC += Math.cos(phase);
      sumS += Math.sin(phase);
    }
    // 平均ベクトル長 R ∈ [0,1]。1 に近いほど位相が集中＝行が揃っている。
    const R = Math.sqrt(sumC * sumC + sumS * sumS) / items.length;
    if (R > best.R) best = { s, R };
  }
  return best.s;
}

// items を deskew y でクラスタリングして物理行を作る。
// 各行 { yKey(デスキュー後の代表y), items:[...] }。
function clusterRows(items, slope, pitch) {
  const withKey = items
    .map((it) => ({ ...it, yKey: it.yc - slope * it.xc }))
    .sort((a, b) => a.yKey - b.yKey);
  const rows = [];
  const gapThr = pitch * 0.55;
  for (const it of withKey) {
    const last = rows[rows.length - 1];
    if (last && it.yKey - last.yKey <= gapThr) {
      last.items.push(it);
      last.yKey = last.items.reduce((s, x) => s + x.yKey, 0) / last.items.length;
    } else {
      rows.push({ yKey: it.yKey, items: [it] });
    }
  }
  return rows;
}

// =============================================================================
// END 物理行 → エントリ（START 物理行）の対応づけ
// =============================================================================
//
// 明細1行には エントリ K の START 列群（No〜乗車地）と END 列群（降車地〜備考）が
// 印字されるが、END 列群は START 列群に対して縦にずれて出る（印字ヘッドの段ずれ）。
// ずれ量は画像ごとに違い、実測で -1.2 ピッチ 〜 +0.2 ピッチ（1ピッチ以上ばらつく）。
//
// 旧実装は「No が数字で読めた START 行」と END 行を上から順に 1:1 対応させていた。
// これは No が1つでも読めないと以降の全 END が1行ズレる。実際 2026/06/18 の明細は
// 用紙のパンチ穴が No.11/12 を潰し、その2行が営業行から丸ごと落ちたうえ、13件目以降
// の降車地・km・料金が2つ手前のエントリのものになった（IMG_1556 で再現・実証）。
//
// そこで No に依存せず y 幾何で対応づける:
//   1. 系統オフセット Δ（= endY − startY）の候補を広く走査する。
//      Δ が 1 ピッチずれた偽解（エイリアス）は、構造ペナルティで排除する:
//        ・休 行に END が付く       … 休 行に END 列は無い（強いペナルティ）
//        ・No の読めた行に END が付かない … トリップには必ず END がある
//        ・END 行が余る             … END は必ずどれかのエントリのもの
//   2. 各 Δ について順序保存の最適割当を DP で解き、総コスト最小の Δ を採る。
// コストは全て「ピッチ単位」で表し、画像の解像度に依らないようにする。

// 割当コストの重み（ピッチ単位）。
const AS_TOL = 0.45;        // このズレを超える組み合わせは対応候補にしない
const AS_REST_MATCH = 2.0;  // 休 行に END を付けたときの罰
const AS_TRIP_MISS = 0.8;   // No の読めたトリップ行に END が付かないときの罰
const AS_UNKNOWN_MISS = 0.25; // No が読めない行に END が付かないときの罰（弱）
const AS_END_SKIP = 1.5;    // END 行を余らせたときの罰

/**
 * END 物理行を START 物理行（エントリ）へ順序保存で対応づける。
 * @param {Array<{y:number, kind:'trip'|'rest'|'unknown'}>} starts y 昇順の START 物理行
 * @param {Array<number>} endYs y 昇順の END 物理行の代表 y
 * @param {number} pitch 行ピッチ（px）
 * @returns {{map:Array<number>, delta:number, cost:number}}
 *   map[j] = endYs[j] を割り当てた starts の index（-1 は未割当）
 */
export function assignEndRows(starts, endYs, pitch) {
  const m = endYs.length;
  const n = starts.length;
  if (!m || !n || !(pitch > 0)) return { map: new Array(m).fill(-1), delta: 0, cost: 0 };

  const skipStartCost = (i) => {
    const k = starts[i].kind;
    if (k === 'trip') return AS_TRIP_MISS;
    if (k === 'unknown') return AS_UNKNOWN_MISS;
    return 0; // rest: END が無いのが正常
  };

  // 与えられた Δ で順序保存の最適割当を DP で解く。
  function solve(delta) {
    const INF = Infinity;
    // best[i][j] = starts[0..i) と endYs[0..j) まで処理したときの最小コスト
    const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
    const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    best[0][0] = 0;
    for (let i = 1; i <= n; i++) {
      best[i][0] = best[i - 1][0] + skipStartCost(i - 1);
      from[i][0] = 1; // START スキップ
    }
    for (let j = 1; j <= m; j++) {
      best[0][j] = best[0][j - 1] + AS_END_SKIP;
      from[0][j] = 2; // END スキップ
    }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let cur = best[i - 1][j] + skipStartCost(i - 1);
        let mode = 1;
        const skipEnd = best[i][j - 1] + AS_END_SKIP;
        if (skipEnd < cur) { cur = skipEnd; mode = 2; }
        const resid = Math.abs(endYs[j - 1] - starts[i - 1].y - delta) / pitch;
        if (resid <= AS_TOL && best[i - 1][j - 1] < INF) {
          const match =
            best[i - 1][j - 1] + resid +
            (starts[i - 1].kind === 'rest' ? AS_REST_MATCH : 0);
          if (match < cur) { cur = match; mode = 3; }
        }
        best[i][j] = cur;
        from[i][j] = mode;
      }
    }
    // 逆追跡
    const map = new Array(m).fill(-1);
    let i = n, j = m;
    while (i > 0 || j > 0) {
      const mode = i === 0 ? 2 : j === 0 ? 1 : from[i][j];
      if (mode === 3) { map[j - 1] = i - 1; i--; j--; }
      else if (mode === 2) { j--; }
      else { i--; }
    }
    return { map, cost: best[n][m] };
  }

  // Δ の探索範囲は実測ばらつき（-1.2〜+0.2 ピッチ）に余裕を持たせる。
  // 1px 刻み（DP は n*m が数千なので全走査でも軽い）。
  const lo = Math.round(-2.0 * pitch);
  const hi = Math.round(1.0 * pitch);
  let bestOverall = null;
  for (let d = lo; d <= hi; d++) {
    const r = solve(d);
    if (!bestOverall || r.cost < bestOverall.cost) bestOverall = { ...r, delta: d };
  }
  return bestOverall;
}

// メイン: OCR boxes → {rows}
//
// 行の扱い:
//   テンプレートは「列境界」と「行ピッチ」を固定で持つ。列はアフィンフィットで
//   ピクセルに落とす（頑健）。行は、START 列の box（No/乗車/降車/時間）を y で
//   物理行にクラスタリングして得る。テンプレ pitch は「行間ギャップのしきい値」
//   と「クラスタの妥当性チェック」にのみ使い、行 index を絶対座標から推論しない
//   （先行アプローチが過適合した箇所）。
//
// START/END の対応（構造的事実・A,B 両方で確認）:
//   各物理印刷行は エントリ K の START 列 と エントリ K+1 の END 列 を並べる。
//   よって エントリ K の END 列 box は、エントリ K の START 行の「1つ上」の
//   物理行に印字される。OCR座標で言うと END box は自分のエントリの START 行より
//   高い位置にあり、その「すぐ下にある START 行」が END の所属エントリ。
//   ⇒ END box は「その y より下にある最も近い START 行」へ割り当てる。
//   （A: END は START の ~0.65pitch 上、B: ~1.1pitch 上 — 比率は画像で揺れるが
//     "すぐ下の START 行" で引けば両方とも正しいエントリに付く。）
export function reconstructRows(ocr) {
  const boxes = (ocr && ocr.boxes) || [];
  const loc = locateTable(boxes);
  if (!loc) return { rows: [], _note: 'table not located' };
  const grid = buildGrid(loc);
  const { colBoundsPx, pitch } = grid;

  // ETC明細セクションで下端カット。
  // 見出し「ETC明細」はOCRで崩れやすく(実測: 細→辅/明組/期柜 等)、それだけだと
  // カットに失敗しETC明細表の行を乗車として拾う(営業回数の水増し)。そこで ETC明細表
  // だけに現れる列ラベル「預り金」「会社負担」も目印にする。これらは営業明細の地名
  // (区+町名)にも上部サマリーにも出ないので min-Y を取っても本表を誤って切らない
  // (「乗務員」は上部「乗務員氏名」に出るため使わない)。
  let etcY = Infinity;
  for (const b of boxes) {
    if (/ETC明細|ＥＴＣ明細|ＥＴＣ明組|ETC明組|預り?金|会社負担/.test(txt(b))) {
      etcY = Math.min(etcY, b.bbox[1]);
    }
  }
  const labelBoxes = loc.header.labelBoxes || new Set();
  // 見出しを使わず特定した場合は、本文帯の下端でも切る（ETC明細の混入防止）。
  if (loc.bodyBottom != null && loc.bodyBottom < etcY) etcY = loc.bodyBottom;

  const order = TEMPLATE.columns;
  const colDef = order.map((n) => KEIHO_COLUMNS.find((c) => c.name === n));
  const startCols = new Set(
    colDef.map((c, i) => (c.group === 'start' ? i : -1)).filter((i) => i >= 0)
  );

  // --- 明細領域の box 候補を集める ---
  // colIdx と group は後で付与。ここではヘッダー上・ETC下のみ大まかに切る。
  const headerBottom = loc.header.bottom;
  const headerTop = loc.header.top;
  const headerY = loc.header.y;
  const candidates = [];
  for (const b of boxes) {
    if (labelBoxes.has(b)) continue;
    if (!txt(b)) continue;
    const yc = cy(b);
    if (yc >= etcY) continue;
    if (b.bbox[3] < headerTop + 2) continue;       // ヘッダー上端より完全に上
    candidates.push({ b, xc: cx(b), yc, xl: b.bbox[0], xr: b.bbox[2] });
  }
  if (!candidates.length) return { rows: [], _note: 'no body cells' };

  // --- 列の傾き（column lean）を測定し、列割り当てを y 補正する ---
  // 印刷フォームは前処理後にシア変形する。シアは行を水平に保ったまま縦の列罫線
  // を傾ける（A: 行はほぼ水平だが列は y につれ ~0.036*Δy ドリフトする）。
  // 列境界はヘッダー（headerY 付近）で測ったので、y の離れた box は
  // x を補正してから列判定する: xCorr = xc - lean*(yc - headerY)。
  // lean は縦の列罫線の傾き（dx/dy）。前処理シアで画像ごとに異なる。
  // 探索で求める: 候補 lean で x をデスキューし、各 box をテンプレ列中心
  // （colCenterPx）の最寄りへスナップした残差を最小化する。テンプレ列中心
  // という固定アンカーがあるので過適合しない。
  // 残差は外れ box（サマリ箱の取りこぼし等）に引っ張られないよう、
  // 半セル幅で頭打ちにする（capped MAE）。
  const colCenterPx = grid.colCenterPx;
  function findColLean(items, anchorIdxs) {
    if (items.length < 8) return 0;
    const centers = anchorIdxs.map((i) => colCenterPx[i]);
    // キャップ = アンカー列間隔の最小値の半分
    let cap = Infinity;
    for (let i = 1; i < centers.length; i++) {
      cap = Math.min(cap, Math.abs(centers[i] - centers[i - 1]) / 2);
    }
    if (!isFinite(cap)) cap = 40;
    let best = { lean: 0, score: Infinity };
    for (let lean = -0.07; lean <= 0.07; lean += 0.0005) {
      let score = 0;
      for (const it of items) {
        const xc = it.xc - lean * (it.yc - headerY);
        let nd = Infinity;
        for (const cc of centers) {
          const d = Math.abs(xc - cc);
          if (d < nd) nd = d;
        }
        score += Math.min(nd, cap); // capped MAE: 外れ box の影響を抑える
      }
      if (score < best.score) best = { lean, score };
    }
    return best.lean;
  }
  // 列が 乗車地|降車地 で大きく離れるため、START 群 / END 群を別に測る。
  // アンカー列: START = No,乗車,降車,時間（数値で幅 ~70px, 等間隔, dense）。
  //             END   = 降車地,営Km,合計,料金,備考（幅広く十分離れている）。
  const startEndSplitX = colBoundsPx[6];
  const startCand = candidates.filter((c) => c.xc < startEndSplitX);
  const endCand = candidates.filter((c) => c.xc >= startEndSplitX);
  const startLean = findColLean(startCand, [0, 1, 2, 3]);
  const endLean = findColLean(endCand, [6, 7, 10, 11, 15]);

  // --- パス2: lean 補正して box を 明細領域 × 列 index に振り分け ---
  // 列判定は box の x 区間（lean 補正後）と列範囲の重なり最大で行う。
  // 数値 box・幅広テキスト box の両方を正しく当てられる。
  //
  // 補正規則（テンプレ構造に基づく確定事実）:
  //   迎 はフラグ列（"迎" の 1 文字のみ）。乗車地 は左寄せの幅広テキスト列。
  //   乗車地 のテキスト box は左端が 迎 列に食い込みがちで、重なり判定で 迎 に
  //   誤割り当てされることがある。迎 へ落ちた box が地名らしいテキスト
  //   （漢字を含み 2 文字以上）なら 乗車地 (idx5) へ送る。
  const IDX_NO = 0, IDX_NORIBA_TIME = 1, IDX_MUKAE = 4, IDX_NORIBA = 5;
  const placed = [];
  for (const c of candidates) {
    const lean = c.xc < startEndSplitX ? startLean : endLean;
    const dy = c.yc - headerY;
    const xlC = c.xl - lean * dy;
    const xrC = c.xr - lean * dy;
    let ci = colIndexByOverlap(xlC, xrC, colBoundsPx);
    if (ci < 0) continue;
    const t = txt(c.b);
    // 迎 はフラグ列。地名らしいテキストが落ちたら 乗車地 へ送る。
    if (ci === IDX_MUKAE) {
      const isFlagLike = t.length <= 1 || /^[迎連週迅]+$/.test(t);
      if (!isFlagLike && /[一-鿿]/.test(t)) ci = IDX_NORIBA;
    }
    // No は 1〜3 文字の数字/休 のみ。時刻らしい box（":" を含む等）が
    // 列ドリフトで No に食い込んだら 乗車（時刻列）へ送る。
    if (ci === IDX_NO && /[:：]/.test(t)) ci = IDX_NORIBA_TIME;
    const isStart = startCols.has(ci);
    // START 列はヘッダー下端より下のみ。END 列はヘッダー上端より下（END_1 救済）。
    // 判定は box 上端でなく中心 yc で行う。明細表の1行目はヘッダー行と y が
    // 接近し、上端判定だと1行目の START 列をヘッダー扱いで丸ごとカットして
    // しまう（ヘッダーラベル自体は labelBoxes で別途名指し除外済み）。
    if (isStart) {
      if (c.yc < headerBottom) continue;
    }
    placed.push({ b: c.b, xc: c.xc, yc: c.yc, ci, isStart });
  }
  if (!placed.length) return { rows: [], _note: 'no body cells' };

  // --- START 列 box を物理行にクラスタリング（デスキュー込み）---
  // START 列群（No〜乗車地）は x 範囲が狭く、回転が小さい画像ではほぼ水平。
  // 回転の大きい画像（B）に備えてデスキュー傾きを探索で求めてからクラスタする。
  const startItemsAll = placed.filter((p) => p.isStart);
  const startSlope = findDeskewSlope(startItemsAll, pitch);
  const startRows = clusterRows(startItemsAll, startSlope, pitch);
  if (!startRows.length) return { rows: [], _note: 'no start rows' };

  // --- END 列 box を物理行にクラスタリング（デスキュー込み）---
  // 重要: END 列群（降車地〜備考）は x 範囲が広く、印刷フォーム固有の傾き＋
  // 前処理回転で 1 エントリ内の y が ~1 ピッチ分も広がる（A: 備考 y262 〜 降車地
  // y295）。そのまま y クラスタすると 1 エントリの END 列が複数行へ割れる。
  // END 群独立にデスキュー傾きを探索して補正してからクラスタリングする。
  const endItemsAll = placed.filter((p) => !p.isStart);
  const endSlope = findDeskewSlope(endItemsAll, pitch);
  const endRowsAll = clusterRows(endItemsAll, endSlope, pitch);

  // 実体のある END 物理行だけ残す。ヘッダーラベルの取りこぼし（例: 現収）が
  // 1〜2 box の偽クラスタを作り、順序対応を 1 ズラすため除外する。
  // 偽クラスタの特徴: box 数が少なく、かつ全 box がヘッダー列名そのもの
  // （= 数値データでない）。データ行は 営Km/合計/料金 等に数字を含む。
  // box が「ヘッダー列名(の誤読)」か。降車地ヘッダーは誤読で "晓車地" 等の地名様に
  // なり matchHeaderLabel を外すため、「車地」で終わる語も列名扱いにする(地名は
  // 区+町名で "車地" 終わりにならない)。
  const isHeaderLabelBox = (it) => {
    const t = normalizeKanji(txt(it.b));
    return matchHeaderLabel(t) !== null || /車地$/.test(t);
  };
  // box が実データ(2桁以上の数値=営Km/合計/料金 等)か。
  // 注: 「降車地の地名だけ」は実データに数えない。回送(回)行も降車地を持ち、その END は
  //     "降車地:◯◯" 1box(金額/kmなし)で END 物理行になる。これを残すと numbered トリップの
  //     END 対応が1つズレる(No.11以降の降車地/運賃が1つ前のものに)。本物のトリップ END は
  //     必ず合計/料金等の数値を持ち、3box以上として別途残るので地名cluseは不要。
  const isDataBox = (it) => {
    if (isHeaderLabelBox(it)) return false;
    const t = normalizeKanji(txt(it.b));
    return t.replace(/[^0-9]/g, "").length >= 2;  // 数値データ（2桁以上）
  };
  // 実体のある END 物理行だけ残す。表ヘッダーの END 列ラベル行(降車地/営Km/合計…。
  // 降車地は誤読で地名様になる)や、備考折り返し断片を END 物理行に数えると、END が
  // 1つ増えて以降のエントリ対応が全て1つズレる(各乗車の降車地/運賃が1つ前のものに)。
  // データboxが皆無でラベル様boxを含む行はヘッダー行として落とす。
  const endRowsRaw = endRowsAll.filter((er) => {
    const dataish = er.items.some(isDataBox);
    if (!dataish && er.items.some(isHeaderLabelBox)) return false;
    if (er.items.length >= 3) return true;
    return dataish;
  });

  function rawYc(row) {
    return row.items.reduce((s, it) => s + it.yc, 0) / row.items.length;
  }
  const startRawYc = startRows.map(rawYc);

  // --- 各 START 行の種別（トリップ / 休憩 / 不明）を判定 ---
  // 構造的事実: END 列（降車地・料金 等）は「トリップ」にのみ印字される。
  // 休 行は START 列のみ。
  // No が読めない行（パンチ穴で潰れる・誤読）は 'unknown'。トリップかもしれないので
  // END を付ける候補として残す（旧実装はここで落としていた）。
  function noTextOf(row) {
    const bs = (row.items.filter((it) => it.ci === 0) || []).map((it) => it.b);
    if (!bs.length) return '';
    bs.sort((a, b) => cx(a) - cx(b));
    return bs.map(txt).join('');
  }
  const startKinds = startRows.map((row) => {
    const noText = noTextOf(row);
    if (/[休保㈱]/.test(noText)) return 'rest';
    if (/\d/.test(toHalfDigits(noText)) || /貸/.test(noText)) return 'trip';
    return 'unknown';
  });

  // --- END 物理行 → エントリ対応（y 幾何ベース）---
  // assignEndRows を参照。No の読めた行の順序には依存しない。
  const endSorted = endRowsRaw
    .map((er) => ({ er, ey: rawYc(er) }))
    .sort((a, b) => a.ey - b.ey);
  const starts = startRows.map((_, i) => ({ y: startRawYc[i], kind: startKinds[i] }));
  const assign = assignEndRows(starts, endSorted.map((e) => e.ey), pitch);

  const endByEntry = startRows.map(() => []);
  assign.map.forEach((si, j) => {
    if (si >= 0) endByEntry[si].push(...endSorted[j].er.items);
  });

  // --- 行ごとに START/END バケットを作り finalizeRow ---
  const columnsForFinalize = colDef.map((c) => ({
    name: c.name, type: c.type, group: c.group,
  }));

  function toBucket(items) {
    const bucket = {};
    for (const it of items) {
      const name = order[it.ci];
      if (!bucket[name]) bucket[name] = [];
      bucket[name].push(it.b);
    }
    return bucket;
  }

  // エントリ K = START 物理行 K の START 列 + endByEntry[K] の END 列。
  const rows = [];
  for (let r = 0; r < startRows.length; r++) {
    const startBucket = toBucket(startRows[r].items);
    const endBucket = toBucket(endByEntry[r]);
    const entry = { start: startBucket, end: endBucket };
    const row = finalizeRow(entry, columnsForFinalize);
    row._rowY = Math.round(startRawYc[r]);
    rows.push(row);
  }

  const _debug = {
    pitch,
    startRows: startRows.map((sr, i) => ({
      y: startRawYc[i],
      kind: startKinds[i],
      no: noTextOf(sr),
      end: assign.map.indexOf(i),
      text: sr.items.slice().sort((a, b) => a.xc - b.xc).map((it) => txt(it.b)).join(' | '),
    })),
    endRows: endSorted.map(({ er, ey }) => ({
      y: ey,
      text: er.items.slice().sort((a, b) => a.xc - b.xc).map((it) => txt(it.b)).join(' | '),
    })),
    endRowsDropped: endRowsAll
      .filter((er) => !endRowsRaw.includes(er))
      .map((er) => ({
        y: rawYc(er),
        text: er.items.slice().sort((a, b) => a.xc - b.xc).map((it) => txt(it.b)).join(' | '),
      })),
  };

  return {
    rows,
    _grid: { pitch, startRows: startRows.length },
    _loc: { a: loc.xm.a, b: loc.xm.b, inliers: loc.xm.inliers },
    _debug,
  };
}

export { locateTable, buildGrid, TEMPLATE };

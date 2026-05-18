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
function matchHeaderLabel(text) {
  const t = String(text || '').trim();
  if (HEADER_ALIASES[t]) return HEADER_ALIASES[t];
  // 前後ノイズ保険: エイリアスが先頭/末尾に来る場合のみ部分一致を許す。
  for (const [alias, name] of Object.entries(HEADER_ALIASES)) {
    if (alias.length < 2) continue;
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
  const headerTop = Math.min(...headerBoxes.map((hb) => hb.box.bbox[1]));
  const headerBottom = Math.max(...headerBoxes.map((hb) => hb.box.bbox[3]));
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
function normalizeCell(rawText, type, confidence) {
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
    if (digits) {
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

// ヘッダーラベル box 群を取得（最も明細表らしい y 帯を選ぶ）。
function locateTable(boxes) {
  const header = findHeaderRow(boxes);
  if (!header) return null;

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
  if (points.length < 4) return null;

  // x 軸アフィン: pixelX = ax + bx * frac。
  // これがテーブル領域の特定: 16 列の x ピクセル位置が一意に決まる。
  const xm = robustAffine(points);
  if (!xm) return null;

  return { header, xm };
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

  // ETC明細マーカーで下端カット
  let etcY = Infinity;
  for (const b of boxes) {
    if (/ETC明細|ＥＴＣ明細|ＥＴＣ明組|ETC明組/.test(txt(b))) {
      etcY = Math.min(etcY, b.bbox[1]);
    }
  }
  const labelBoxes = loc.header.labelBoxes || new Set();

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
    if (isStart) {
      if (c.b.bbox[1] < headerBottom - 2) continue;
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
  const endRowsRaw = endRowsAll.filter((er) => {
    if (er.items.length >= 3) return true;
    // 2 box 以下: ヘッダーラベル取りこぼしでないこと（数字 or 地名を含む）
    return er.items.some((it) => {
      const t = normalizeKanji(txt(it.b));
      if (matchHeaderLabel(t)) return false;        // ヘッダー列名そのもの
      return /\d/.test(t) || /[一-鿿]/.test(t);     // 数値 or 漢字（地名）
    });
  });

  function rawYc(row) {
    return row.items.reduce((s, it) => s + it.yc, 0) / row.items.length;
  }
  const startRawYc = startRows.map(rawYc);

  // --- 各 START 行が numbered（通常トリップ）か 休（休憩）かを判定 ---
  // 構造的事実: END 列（降車地・料金 等）は「トリップ」にのみ印字される。
  // 休 行は START 列のみ。よって END 物理行は numbered 行と 1:1 で並ぶ。
  // No セルを正規化して判定する。
  function noTextOf(row) {
    const bs = (row.items.filter((it) => it.ci === 0) || []).map((it) => it.b);
    if (!bs.length) return '';
    bs.sort((a, b) => cx(a) - cx(b));
    return bs.map(txt).join('');
  }
  const isNumbered = startRows.map((row) => {
    const t = toHalfDigits(noTextOf(row));
    return /\d/.test(t) && !/[休保㈱]/.test(noTextOf(row));
  });

  // --- END 物理行 → エントリ対応 ---
  // 構造的事実（A,B 両方で確認）:
  //   (1) END 列は numbered トリップにのみ印字される（休 行に END 列は無い）。
  //   (2) END 物理行クラスタは numbered エントリと「上から順に 1:1」で並ぶ。
  // よって y 昇順の j 番目の END 物理行 → j 番目の numbered START 行（トリップ）。
  // 休 行・先頭エントリの違いに依らず順序だけで決まる。
  // ただし OCR が END 物理行を 1 つ落とすと以降が 1 ズレる。これを防ぐため、
  // 割り当て後に「END 行 y と numbered START 行 y のズレ」を見て、ズレが
  // 系統的に大きくなったら numbered 行側をスキップして整合を取り戻す。
  const numberedIdx = [];
  startRows.forEach((_, i) => { if (isNumbered[i]) numberedIdx.push(i); });

  const endByEntry = startRows.map(() => []);
  const endSorted = endRowsRaw
    .map((er) => ({ er, ey: rawYc(er) }))
    .sort((a, b) => a.ey - b.ey);

  // END 物理行 j とトリップ numberedIdx[k] は同じ物理行群に属する。
  // END 物理行 j の y は numberedIdx[k] の START 行 y とおおむね同じ
  // （END は自分のトリップ行の1つ上だが、隣接トリップ間 pitch 程度のズレ）。
  // 貪欲＋ズレ監視で対応づける。
  let k = 0;
  for (const { er, ey } of endSorted) {
    if (k >= numberedIdx.length) break;
    // 現在候補トリップの START 行より END 行 y が大きく下なら、
    // 落ちた numbered 行があるので候補を進める。
    while (
      k + 1 < numberedIdx.length &&
      ey - startRawYc[numberedIdx[k]] > pitch * 1.4
    ) {
      k++;
    }
    endByEntry[numberedIdx[k]].push(...er.items);
    k++;
  }

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

  return {
    rows,
    _grid: { pitch, startRows: startRows.length },
    _loc: { a: loc.xm.a, b: loc.xm.b, inliers: loc.xm.inliers },
  };
}

export { locateTable, buildGrid, TEMPLATE };

// tools/js/traffic-count-data.js — 警視庁 定期交通量調査（主要交差点・区部）の材料づくり（純粋な部分）
//
// 元データ: 警視庁「交通量統計表」令和6年 主要交差点交通量（区部）CSV。
//   kousaten_NNNN_houkou.csv      流入方向別（流入方向×流出方向×時間帯×車種）
//   kousaten_NNNN_ryuusyutu.csv   流出方向別（流出方向×時間帯×車種）
//   kousaten_NNNN_jitensya.csv    自転車（流入方向×流出方向×時間帯、車道/歩道/計）
// 値は「調査日の7時〜19時に観測した実績」。現在の交通量・通常日の代表値・渋滞予測ではない。
// 変換（.github/scripts/build-keishicho-traffic-counts.mjs）と画面（traffic-count-layer.js）の両方から使う。
// DOM や MapLibre には触らない。

export const VEHICLE_KEYS = [
  ['largePassenger', '大型乗用'],
  ['largeCargo', '大型貨物'],
  ['passenger', '普通乗用'],
  ['cargo', '普通貨物'],
  ['fourWheel', '四輪計'],
  ['twoWheel', '二輪車'],
];
export const BIKE_KEYS = [
  ['onRoad', '車道通行自転車'],
  ['onSidewalk', '歩道通行自転車'],
  ['total', '自転車計'],
];
export const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
export const TOTAL_LABEL = '12時間計';

// 東京23区を囲む枠（生成物の検査用。島しょ・多摩は含めない）
export const TOKYO23_BOUNDS = { minLat: 35.48, maxLat: 35.83, minLon: 139.55, maxLon: 139.93 };

// 公開用 JSON に入れてよい座標の確認状態
export const PUBLIC_COORD_STATUSES = ['verified-osm', 'verified-visual'];

const nfkc = (s) => String(s ?? '').normalize('NFKC');

/** セルの値: 数字→数、'-'・空→null（0 にしない）。読めない値は undefined を返して呼び出し元で記録する */
export function parseCount(v) {
  const s = nfkc(v).trim();
  if (s === '' || s === '-') return null;
  if (/^\d+$/.test(s)) return Number(s);
  return undefined;
}

/** 時間帯の欄: '7'〜'18' → 数、'12時間計' → 'total'。それ以外は null */
export function parseHour(v) {
  const s = nfkc(v).trim();
  if (s === TOTAL_LABEL) return 'total';
  if (/^\d{1,2}$/.test(s)) {
    const h = Number(s);
    return HOURS.includes(h) ? h : null;
  }
  return null;
}

/** 流入・流出方向: 'A 五反田' → { code: 'A', label: '五反田' } */
export function parseApproach(v) {
  const s = nfkc(v).trim();
  const m = s.match(/^([A-Z])\s*(.*)$/);
  // 「トンネル」「側道」のように記号の無い方向は、名前をそのまま記号として使う
  return m ? { code: m[1], label: m[2].trim() } : { code: s, label: s };
}

/** 流入方向別の流出先: '1.平和島' と '1平和島' を同じ形に。'流入計' は total */
export function parseMovement(v) {
  const s = nfkc(v).trim();
  if (s === '流入計') return { total: true };
  const m = s.match(/^(\d+)\.?\s*(.*)$/);
  return m ? { no: Number(m[1]), label: m[2].trim() } : { no: null, label: s };
}

/** '環七通りＸ中原街道' → ['環七通り', '中原街道']（括弧は残す） */
export function splitCrossRoads(v) {
  return nfkc(v).split(/[X×xｘ]/).map((x) => x.trim()).filter(Boolean);
}

/** 'R6/11' → '2024-11'（令和n年 = 2018+n 年） */
export function surveyMonthIso(v) {
  const m = nfkc(v).trim().match(/^R(\d+)\/(\d{1,2})$/);
  if (!m) return null;
  return `${2018 + Number(m[1])}-${String(Number(m[2])).padStart(2, '0')}`;
}

// 各 CSV のいつもの見出し（見出しの行が抜けているファイルがあるため、そのときはこれを使う）
export const CSV_HEADERS = {
  houkou: ['地点番号', '地点名', '交差道路名', '調査年月', '管轄警察署', '流入方向', '流出方向', '時間帯等', ...VEHICLE_KEYS.map(([, l]) => l)],
  ryuusyutu: ['地点番号', '地点名', '交差道路名', '調査年月', '管轄警察署', '流出方向', '時間帯等', ...VEHICLE_KEYS.map(([, l]) => l)],
  jitensya: ['地点番号', '地点名', '交差道路名', '調査年月', '管轄警察署', '流入方向', '流出方向', '時間帯等', ...BIKE_KEYS.map(([, l]) => l)],
};

/**
 * CSV（引用符なし・カンマ区切り）を、見出しの名前で引けるオブジェクトの配列にする。
 * 1行目が見出しでない（先頭が地点番号の数字）ときは fallbackHeader を使い、headerMissing を立てる。
 */
export function parseCsv(text, fallbackHeader = null) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { header: [], rows: [], headerMissing: false };
  const firstCells = lines[0].split(',').map((h) => nfkc(h).trim());
  const headerMissing = /^\d+$/.test(firstCells[0] || '') && Array.isArray(fallbackHeader);
  const header = headerMissing ? fallbackHeader : firstCells;
  const rows = lines.slice(headerMissing ? 0 : 1).map((l) => {
    const cells = l.split(',');
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] === undefined ? '' : cells[i]; });
    o.__cells = cells.length;
    return o;
  });
  return { header, rows, headerMissing };
}

function emptyCounts(keys) {
  const o = {};
  for (const [k] of keys) o[k] = null;
  return o;
}

function readCounts(row, keys, issue) {
  const o = {};
  for (const [k, label] of keys) {
    const v = parseCount(row[label]);
    if (v === undefined) { issue(`読めない値「${row[label]}」（${label}）`); o[k] = null; } else o[k] = v;
  }
  return o;
}

/** null を含む足し算: 全部 null なら null、1つでも数があれば数の合計（null は足さない） */
function addCounts(a, b, keys) {
  const o = {};
  for (const [k] of keys) {
    const x = a[k]; const y = b[k];
    o[k] = x == null && y == null ? null : (x ?? 0) + (y ?? 0);
  }
  return o;
}

function sameCounts(a, b, keys) {
  return keys.every(([k]) => (a[k] ?? null) === (b[k] ?? null));
}

function diffText(a, b, keys) {
  return keys.filter(([k]) => (a[k] ?? null) !== (b[k] ?? null))
    .map(([k, label]) => `${label} 表=${a[k]} 再計算=${b[k]}`).join('、');
}

/** 時間帯ごとの行（7〜18時と12時間計）を1つの塊にまとめる */
function hourBlock(keys) {
  return { hourly: Object.fromEntries(HOURS.map((h) => [h, emptyCounts(keys)])), total12h: emptyCounts(keys), seen: new Set() };
}

function putHour(block, hour, counts, issue, where) {
  const key = hour === 'total' ? 'total' : hour;
  if (block.seen.has(key)) issue(`${where}: 時間帯「${hour === 'total' ? TOTAL_LABEL : hour}」が2回ある`);
  block.seen.add(key);
  if (hour === 'total') block.total12h = counts; else block.hourly[hour] = counts;
}

function checkBlock(block, keys, issue, where) {
  const missing = HOURS.filter((h) => !block.seen.has(h));
  if (missing.length) issue(`${where}: 時間帯 ${missing.join('・')} 時台の行が無い`);
  if (!block.seen.has('total')) { issue(`${where}: ${TOTAL_LABEL}の行が無い`); return; }
  let sum = emptyCounts(keys);
  for (const h of HOURS) sum = addCounts(sum, block.hourly[h], keys);
  if (!sameCounts(block.total12h, sum, keys)) issue(`${where}: ${TOTAL_LABEL}と時間別の合計が合わない（${diffText(block.total12h, sum, keys)}）`);
}

const finish = (block) => ({ hourly: HOURS.map((h) => ({ hour: h, ...block.hourly[h] })), total12h: block.total12h });

/**
 * 1地点の3種の CSV から、地図用の1地点を作る。
 * 戻り値: { point, issues }。issues は地点番号つきの品質メモ（合計の食い違い・読めない値など）。
 */
export function buildPoint({ houkou, ryuusyutu, jitensya }) {
  const issues = [];
  const H = parseCsv(houkou, CSV_HEADERS.houkou);
  if (H.rows.length === 0) throw new Error('流入方向別 CSV が空です');
  const first = H.rows[0];
  const pointId = Number(nfkc(first['地点番号']).trim());
  const issue = (msg) => issues.push({ pointId, message: msg });

  const meta = {
    pointId,
    name: nfkc(first['地点名']).trim(),
    crossRoadsRaw: nfkc(first['交差道路名']).trim(),
    crossRoads: splitCrossRoads(first['交差道路名']),
    surveyYearMonth: nfkc(first['調査年月']).trim(),
    surveyMonth: surveyMonthIso(first['調査年月']),
    policeStation: nfkc(first['管轄警察署']).trim(),
  };
  if (H.headerMissing) issue('流入方向別 CSV に見出しの行が無い（いつもの見出しで読んだ）');
  for (const r of H.rows) {
    if (Number(nfkc(r['地点番号']).trim()) !== pointId) issue(`流入方向別に別の地点番号 ${r['地点番号']} が混ざっている`);
    if (nfkc(r['調査年月']).trim() !== meta.surveyYearMonth) issue(`調査年月が行によって違う（${r['調査年月']}）`);
  }

  // ---- 流入方向別 ----
  const approaches = new Map();   // code -> { code, label, total: block, moves: Map(no -> {no,label,block}) }
  for (const r of H.rows) {
    const a = parseApproach(r['流入方向']);
    const mv = parseMovement(r['流出方向']);
    const hour = parseHour(r['時間帯等']);
    if (hour === null) { issue(`流入方向別: 時間帯「${r['時間帯等']}」を読めない`); continue; }
    if (!approaches.has(a.code)) approaches.set(a.code, { code: a.code, label: a.label, total: hourBlock(VEHICLE_KEYS), moves: new Map() });
    const ap = approaches.get(a.code);
    const counts = readCounts(r, VEHICLE_KEYS, (m) => issue(`流入方向別 ${a.code}: ${m}`));
    if (mv.total) { putHour(ap.total, hour, counts, issue, `流入 ${a.code} 流入計`); continue; }
    if (!ap.moves.has(mv.no)) ap.moves.set(mv.no, { no: mv.no, label: mv.label, block: hourBlock(VEHICLE_KEYS) });
    putHour(ap.moves.get(mv.no).block, hour, counts, issue, `流入 ${a.code}→${mv.no}`);
  }
  const approachList = [...approaches.values()].sort((x, y) => String(x.code).localeCompare(String(y.code)));
  for (const ap of approachList) {
    checkBlock(ap.total, VEHICLE_KEYS, issue, `流入 ${ap.code} 流入計`);
    for (const mv of ap.moves.values()) checkBlock(mv.block, VEHICLE_KEYS, issue, `流入 ${ap.code}→${mv.no}`);
    // 流入計 = 流出先ごとの合計（流出先の行が無い方向は、比べる相手が無いので比べない）
    if (ap.moves.size === 0) continue;
    for (const key of [...HOURS, 'total']) {
      let sum = emptyCounts(VEHICLE_KEYS);
      for (const mv of ap.moves.values()) sum = addCounts(sum, key === 'total' ? mv.block.total12h : mv.block.hourly[key], VEHICLE_KEYS);
      const table = key === 'total' ? ap.total.total12h : ap.total.hourly[key];
      if (!sameCounts(table, sum, VEHICLE_KEYS)) issue(`流入 ${ap.code} の${key === 'total' ? TOTAL_LABEL : `${key}時台`}: 流入計と流出先ごとの合計が合わない（${diffText(table, sum, VEHICLE_KEYS)}）`);
    }
  }

  // 流入計を足し直した合計（公式の「全方向合計」と比べるための再計算値。見出しには使わない）
  let allHourly = Object.fromEntries(HOURS.map((h) => [h, emptyCounts(VEHICLE_KEYS)]));
  let allTotal = emptyCounts(VEHICLE_KEYS);
  for (const ap of approachList) {
    for (const h of HOURS) allHourly[h] = addCounts(allHourly[h], ap.total.hourly[h], VEHICLE_KEYS);
    allTotal = addCounts(allTotal, ap.total.total12h, VEHICLE_KEYS);
  }

  // ---- 流出方向別 ----
  const exits = new Map();
  let exitAll = null;
  const R = parseCsv(ryuusyutu, CSV_HEADERS.ryuusyutu);
  if (R.headerMissing) issue('流出方向別 CSV に見出しの行が無い（いつもの見出しで読んだ）');
  for (const r of R.rows) {
    const hour = parseHour(r['時間帯等']);
    if (hour === null) { issue(`流出方向別: 時間帯「${r['時間帯等']}」を読めない`); continue; }
    const label = nfkc(r['流出方向']).trim();
    const counts = readCounts(r, VEHICLE_KEYS, (m) => issue(`流出方向別 ${label}: ${m}`));
    if (label === '全方向合計') {
      exitAll ??= hourBlock(VEHICLE_KEYS);
      putHour(exitAll, hour, counts, issue, '流出 全方向合計');
      continue;
    }
    const e = parseApproach(label);
    if (!exits.has(e.code)) exits.set(e.code, { code: e.code, label: e.label, block: hourBlock(VEHICLE_KEYS) });
    putHour(exits.get(e.code).block, hour, counts, issue, `流出 ${e.code}`);
  }
  const exitList = [...exits.values()].sort((x, y) => String(x.code).localeCompare(String(y.code)));
  for (const e of exitList) checkBlock(e.block, VEHICLE_KEYS, issue, `流出 ${e.code}`);
  // 流入計の行が無い流入方向（その方向の車は、足し直した合計に入らない）
  const approachesWithoutTotal = approachList.filter((ap) => ap.total.seen.size === 0).map((ap) => ap.code);
  let totalsDiffer = false;
  if (exitAll) {
    checkBlock(exitAll, VEHICLE_KEYS, issue, '流出 全方向合計');
    // 流出の全方向合計 = 流入計の合計（同じ車を入口と出口で数えている）。12時間計と時間別の両方で比べる
    if (!sameCounts(exitAll.total12h, allTotal, VEHICLE_KEYS)) {
      totalsDiffer = true;
      issue(`流出の全方向合計（公式）と流入計を足し直した合計が合わない（12時間計: ${diffText(exitAll.total12h, allTotal, VEHICLE_KEYS)}）`);
    }
    for (const h of HOURS) {
      if (!sameCounts(exitAll.hourly[h], allHourly[h], VEHICLE_KEYS)) { totalsDiffer = true; issue(`流出の全方向合計（公式）と流入計を足し直した合計が合わない（${h}時台: ${diffText(exitAll.hourly[h], allHourly[h], VEHICLE_KEYS)}）`); }
    }
  } else if (ryuusyutu) issue('流出方向別に「全方向合計」の行が無い');
  // 見出しの合計は公式の「全方向合計」。無いときだけ、流入計を足し直した値（そうと分かる印を付ける）
  const official = exitAll ? finish(exitAll) : null;

  // ---- 自転車 ----
  let bicycle = { present: false, total12h: emptyCounts(BIKE_KEYS), hourly: HOURS.map((h) => ({ hour: h, ...emptyCounts(BIKE_KEYS) })) };
  if (jitensya) {
    const all = hourBlock(BIKE_KEYS);
    let found = false;
    const J = parseCsv(jitensya, CSV_HEADERS.jitensya);
    if (J.headerMissing) issue('自転車 CSV に見出しの行が無い（いつもの見出しで読んだ）');
    for (const r of J.rows) {
      if (nfkc(r['流入方向']).trim() !== '全方向計') continue;
      const hour = parseHour(r['時間帯等']);
      if (hour === null) { issue(`自転車: 時間帯「${r['時間帯等']}」を読めない`); continue; }
      putHour(all, hour, readCounts(r, BIKE_KEYS, (m) => issue(`自転車 全方向計: ${m}`)), issue, '自転車 全方向計');
      found = true;
    }
    if (found) {
      checkBlock(all, BIKE_KEYS, issue, '自転車 全方向計');
      const f = finish(all);
      bicycle = { present: BIKE_KEYS.some(([k]) => f.total12h[k] != null), ...f };
    } else issue('自転車に「全方向計」の行が無い');
  }

  const point = {
    ...meta,
    surveyHours: { start: 7, end: 19, label: '7時〜19時（12時間）' },
    total12h: official ? official.total12h : allTotal,
    hourly: official ? official.hourly : HOURS.map((h) => ({ hour: h, ...allHourly[h] })),
    totalSource: official ? 'official' : 'recomputed',
    inflowSum12h: allTotal,
    totalsDiffer,
    approachesWithoutTotal,
    approaches: approachList.map((ap) => ({
      code: ap.code,
      label: ap.label,
      ...finish(ap.total),
      movements: [...ap.moves.values()].sort((x, y) => x.no - y.no).map((mv) => ({ no: mv.no, label: mv.label, total12h: mv.block.total12h })),
    })),
    exits: exitList.map((e) => ({ code: e.code, label: e.label, ...finish(e.block) })),
    bicycle,
  };
  return { point, issues };
}

/** 生成物（公開用 JSON）の検査。問題を文の配列で返す（空なら合格） */
export function validatePublicData(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['JSON がオブジェクトではない'];
  const m = doc.meta || {};
  for (const k of ['sourceUrl', 'sourcePage', 'fetchedAt', 'zipFileName', 'scriptVersion', 'surveyYearMonths', 'counts']) {
    if (m[k] === undefined || m[k] === null || m[k] === '') errs.push(`meta.${k} が無い`);
  }
  if (!Array.isArray(doc.points)) { errs.push('points が配列ではない'); return errs; }
  const seen = new Set();
  const b = TOKYO23_BOUNDS;
  for (const p of doc.points) {
    const id = p.pointId;
    if (!Number.isInteger(id)) errs.push(`地点番号が整数ではない: ${id}`);
    if (seen.has(id)) errs.push(`地点番号 ${id} が重複`);
    seen.add(id);
    if (!(p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon)) errs.push(`地点 ${id}: 緯度経度が23区の範囲外 (${p.lat}, ${p.lon})`);
    if (!PUBLIC_COORD_STATUSES.includes(p.coordinateStatus)) errs.push(`地点 ${id}: 確認済みでない座標（${p.coordinateStatus}）`);
    if (!p.coordinateSource) errs.push(`地点 ${id}: coordinateSource が無い`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.coordinateCheckedAt || ''))) errs.push(`地点 ${id}: coordinateCheckedAt が日付ではない`);
    for (const k of ['name', 'crossRoadsRaw', 'surveyYearMonth', 'policeStation']) if (!p[k]) errs.push(`地点 ${id}: ${k} が無い`);
    if (!p.total12h || !('fourWheel' in p.total12h)) errs.push(`地点 ${id}: 12時間計が無い`);
    if (!['official', 'recomputed'].includes(p.totalSource)) errs.push(`地点 ${id}: totalSource が無い`);
    if (!Array.isArray(p.crossRoads) || !Array.isArray(p.approaches) || !Array.isArray(p.exits)) errs.push(`地点 ${id}: crossRoads・approaches・exits のどれかが配列ではない`);
    if (!Array.isArray(p.hourly) || p.hourly.length !== HOURS.length || !p.hourly.every((h, i) => h && h.hour === HOURS[i])) errs.push(`地点 ${id}: 時間別が7〜18時の12時間分ない`);
    if (!p.surveyHours || !p.surveyHours.label) errs.push(`地点 ${id}: surveyHours が無い`);
    if (p.armBearings !== undefined) {
      const codes = [...(p.approaches || []), ...(p.exits || [])].map((a) => a.code);
      if (!p.armBearings || typeof p.armBearings !== 'object') errs.push(`地点 ${id}: armBearings の形が違う`);
      else {
        for (const [k, v] of Object.entries(p.armBearings)) if (!(Number.isFinite(v) && v >= 0 && v < 360)) errs.push(`地点 ${id}: 向き ${k} が 0〜359 ではない`);
        for (const c of codes) if (!(c in p.armBearings)) errs.push(`地点 ${id}: 方向 ${c} の向きが無い`);
      }
    }
  }
  if (m.counts && m.counts.shown !== doc.points.length) errs.push(`meta.counts.shown (${m.counts.shown}) と points の数 (${doc.points.length}) が違う`);
  return errs;
}

// ---- 画面用の整形 ----

export const fmtCount = (n) => (n == null ? '—' : Number(n).toLocaleString('ja-JP'));

/** 'R6/11' → '2024年（令和6年）11月' */
export function surveyMonthLabel(p) {
  const iso = p.surveyMonth || surveyMonthIso(p.surveyYearMonth);
  if (!iso) return p.surveyYearMonth || '';
  const [y, mo] = iso.split('-').map(Number);
  return `${y}年（令和${y - 2018}年）${mo}月`;
}

/** 四輪計がいちばん多かった時間帯（同じなら早いほう）。値が無ければ null */
export function peakHour(p) {
  let best = null;
  for (const h of p.hourly || []) {
    if (h.fourWheel == null) continue;
    if (!best || h.fourWheel > best.fourWheel) best = h;
  }
  return best;
}

/** 方向別の要約（流入方向ごとの四輪計の12時間計、多い順） */
export function approachSummary(p) {
  return (p.approaches || [])
    .map((a) => ({ code: a.code, label: a.label, fourWheel: a.total12h?.fourWheel ?? null, twoWheel: a.total12h?.twoWheel ?? null }))
    .sort((x, y) => (y.fourWheel ?? -1) - (x.fourWheel ?? -1));
}

// ---- 地図に描く形 ----

/** 地図に出す短い台数（56784 → '5.7万'、8186 → '8,186'）。値が無ければ '—' */
export function shortCount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 10000) return `${(Math.round(v / 1000) / 10).toFixed(1).replace(/\.0$/, '')}万`;
  return v.toLocaleString('ja-JP');
}

/** 矢印の太さ（m）。台数の平方根に比べる（面積で多さが伝わるように）。0台は描かない */
export function arrowWidthM(fourWheel) {
  if (!(fourWheel > 0)) return 0;
  return Math.min(30, 4 + 20 * Math.sqrt(fourWheel / 20000));
}

/**
 * 交差点 center（[lon, lat]）へ、bearing（度・北が0の時計回り）の側から入ってくる矢印の多角形。
 * 先端は交差点から fromM、根元は toM。返り値は GeoJSON Polygon の座標（[lon, lat] の環）
 */
export function arrowPolygon(center, bearing, { fromM = 26, toM = 150, widthM = 20, headM = null } = {}) {
  const [lon, lat] = center;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const r = (bearing * Math.PI) / 180;
  const ux = Math.sin(r); const uy = Math.cos(r);   // 交差点から外へ向かう向き
  const vx = uy; const vy = -ux;                     // 横向き
  const head = headM ?? Math.max(18, widthM * 1.1);
  const hw = widthM / 2; const hh = Math.max(hw + 6, widthM * 0.95);
  const P = (along, side) => [lon + (ux * along + vx * side) / kx, lat + (uy * along + vy * side) / ky];
  const neck = fromM + head;
  const ring = [P(fromM, 0), P(neck, hh), P(neck, hw), P(toM, hw), P(toM, -hw), P(neck, -hw), P(neck, -hh), P(fromM, 0)];
  return ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

/** 交差点から bearing の側へ m だけ離れた点（[lon, lat]） */
export function offsetPoint(center, bearing, m) {
  const [lon, lat] = center;
  const r = (bearing * Math.PI) / 180;
  return [lon + (Math.sin(r) * m) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(r) * m) / 110540];
}

/** 腕（向きの一覧）のあいだで、いちばん広く空いている向き。地点名の札をそこへ置く。腕が無ければ 180（真下） */
export function widestGap(bearings) {
  const bs = [...new Set((bearings || []).filter(Number.isFinite).map((b) => ((b % 360) + 360) % 360))].sort((a, b) => a - b);
  if (!bs.length) return 180;
  if (bs.length === 1) return (bs[0] + 180) % 360;
  let best = { gap: -1, mid: 180 };
  bs.forEach((b, i) => {
    const next = i + 1 < bs.length ? bs[i + 1] : bs[0] + 360;
    const gap = next - b;
    if (gap > best.gap) best = { gap, mid: (b + gap / 2) % 360 };
  });
  return Math.round(best.mid) % 360;
}

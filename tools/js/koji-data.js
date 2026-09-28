// tools/js/koji-data.js — 工事マップの「材料づくり」（純関数・テストあり）
//
// 工事マップ側（ハッカソン/osanpo-safety）の public/timewindow.js・lanelevel.js・jam.js を
// このアプリへ移植したもの。判定の規則は向こうと同じに保つこと（資料 §5.1・5.2）。
// 元データ: 東京都建設局 路上工事情報 (CC BY 4.0)。東京23区の都道のみ・区道/国道/高速は含まない。
//
// 都データの読み方（向こうの資料より）:
//   - 期間は月単位。開始月の1日〜終了月の末日（endAt には終了月の1日が入っている）
//   - 時間帯は毎日同じ予定。曜日・休工日の情報は元データに無い
//   - 時間帯の記載が無い工事は「期間中ずっと」とみなす

const JST_MS = 9 * 3600 * 1000;

function isTokyo(p) {
  return p.source === 'tokyo_kensetsu' || (typeof p.id === 'string' && p.id.startsWith('tokyo-'));
}

function ymd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function periodBounds(p) {
  let start = null, end = null;
  const s = ymd(p.startAt), e = ymd(p.endAt);
  if (isTokyo(p)) {
    if (s) start = Date.UTC(s[0], s[1] - 1, 1) - JST_MS;
    if (e) end = Date.UTC(e[0], e[1], 1) - JST_MS - 1000;
  } else {
    const dateOnly = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
    if (p.startAt) start = dateOnly(p.startAt) && s ? Date.UTC(s[0], s[1] - 1, s[2]) - JST_MS : Date.parse(p.startAt);
    if (p.endAt) end = dateOnly(p.endAt) && e ? Date.UTC(e[0], e[1] - 1, e[2] + 1) - JST_MS - 1000 : Date.parse(p.endAt);
    if (Number.isNaN(start)) start = null;
    if (Number.isNaN(end)) end = null;
  }
  return { start, end };
}

export function parseWindows(tw) {
  if (!tw) return [];
  return String(tw).split(',').map((w) => {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(w.trim());
    return m ? { s: Number(m[1]) * 60 + Number(m[2]), e: Number(m[3]) * 60 + Number(m[4]) } : null;
  }).filter(Boolean);
}

/** 日本時間の「0時からの分」 */
export function jstMinutes(t) {
  const d = new Date(t + JST_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function inWindows(tw, t) {
  const wins = parseWindows(tw);
  if (wins.length === 0) return true;
  const m = jstMinutes(t);
  return wins.some(({ s, e }) => (s <= e ? m >= s && m < e : m >= s || m < e));
}

/** その時刻に作業中か（期間内かつ時間帯内。日をまたぐ枠に対応） */
export function activeAt(p, t) {
  const { start, end } = periodBounds(p);
  if (start !== null && t < start) return false;
  if (end !== null && t > end) return false;
  return inWindows(p.timeWindow, t);
}

/** 「22:00〜翌6:00」の形 */
export function windowLabel(tw) {
  const wins = parseWindows(tw);
  if (wins.length === 0) return '時間帯の記載なし';
  const hm = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  const seen = new Set();
  return wins.map(({ s, e }) => `${hm(s)}〜${s > e ? '翌' : ''}${hm(e)}`)
    .filter((x) => !seen.has(x) && seen.add(x)).join('、');
}

// --- ふさぎ具合（色分け）--------------------------------------------------
// 重い順。色だけに頼らず凡例に名前を出す。
export const LEVELS = [
  { key: 'closed', label: '通行止め', color: '#b3003c' },
  { key: 'alternating', label: '片側交互', color: '#e0301e' },
  { key: 'half', label: '3分の1以上', color: '#f07f00' },
  { key: 'part', label: '一部の車線', color: '#f5b700' },
  { key: 'unknown', label: '車線数の記載なし', color: '#8b98a6' },
];

export function laneLevel(p) {
  const r = Number(p.lanesRestricted), t = Number(p.lanesTotal);
  const known = Number.isFinite(r) && Number.isFinite(t) && r > 0 && t > 0;
  if (p.restrictionType === 'road_closed' || (known && r >= t)) return 'closed';
  if (p.restrictionType === 'alternating_one_way') return 'alternating';
  if (!known) return 'unknown';
  return r / t >= 1 / 3 ? 'half' : 'part';
}

export function levelInfo(key) {
  return LEVELS.find((l) => l.key === key) || LEVELS[LEVELS.length - 1];
}

// --- 混みやすさ（目安）----------------------------------------------------
// その時刻の交通の多さ ÷ 工事で残る車線の割合。1以上で「混みやすい」。
// 交通の多さ = R3 道路交通センサス・23区都道の24時間観測区間のピーク比（中央値）。
export const HOURLY_PEAK_SHARE = [0.182, 0.189, 0.175, 0.171, 0.201, 0.457, 0.776, 0.943, 0.929, 0.89, 0.878, 0.85,
  0.822, 0.821, 0.857, 0.922, 0.909, 0.954, 0.886, 0.718, 0.531, 0.41, 0.284, 0.244];

const ONE_SIDE = new Set(['上', '下', '内', '外']);

/** 工事で残る車線の割合（0〜1）。分からなければ null */
export function remainingFraction(p) {
  if (p.restrictionType === 'road_closed') return 0;
  if (p.restrictionType === 'alternating_one_way') return 0.35;   // 1車線を上下で分け合う
  const r = Number(p.lanesRestricted), t = Number(p.lanesTotal);
  if (!(r > 0 && t > 0)) return null;
  const oneSide = ONE_SIDE.has(String(p.roadSide || '').trim()) && t >= 2;
  const lanes = oneSide ? t / 2 : t;
  return Math.max(0, (lanes - r) / lanes);
}

export function jamLevel(p, hourJst) {
  const f = remainingFraction(p);
  if (f === null) return 'unknown';
  if (f === 0) return 'blocked';
  const x = HOURLY_PEAK_SHARE[((hourJst % 24) + 24) % 24] / f;
  if (x >= 1) return 'high';
  if (x >= 0.7) return 'mid';
  return 'low';
}

/** 画面に出す1行。「混みやすい」だけを強調し、それ以外は出さない（運転中に読ませない） */
export function jamNote(p, hourJst) {
  const k = jamLevel(p, hourJst);
  if (k === 'blocked') return '通れない';
  if (k === 'high') return '混みやすい時間';
  return '';
}

// --- 表示用のまとめ --------------------------------------------------------
/** 期間の見出し（「2025年10月〜2031年5月」） */
export function periodLabel(p) {
  const s = ymd(p.startAt), e = ymd(p.endAt);
  const f = (a) => `${a[0]}年${a[1]}月`;
  if (s && e) return `${f(s)}〜${f(e)}`;
  if (s) return `${f(s)}〜`;
  return '';
}

/**
 * 表示するものを選ぶ。
 * @param features GeoJSON features
 * @param timeMs 見たい時刻（ミリ秒）
 * @param bounds {minLat,maxLat,minLng,maxLng} 省略可（地図の範囲で絞る）
 */
export function selectActive(features, timeMs, bounds = null) {
  const out = [];
  for (const f of features || []) {
    if (!activeAt(f.properties || {}, timeMs)) continue;
    if (bounds && !intersects(f.geometry, bounds)) continue;
    out.push(f);
  }
  return out;
}

export function intersects(geometry, b) {
  if (!geometry) return false;
  const cs = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
  for (const c of cs) {
    if (c[1] >= b.minLat && c[1] <= b.maxLat && c[0] >= b.minLng && c[0] <= b.maxLng) return true;
  }
  return false;
}

/** 凡例に出す件数（重い順） */
export function countByLevel(features) {
  const n = Object.fromEntries(LEVELS.map((l) => [l.key, 0]));
  for (const f of features) n[laneLevel(f.properties || {})] += 1;
  return n;
}

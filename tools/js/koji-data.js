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
// 色は工事マップ本家 public/lanelevel.js と同じ（見分けがつくよう、本家の値をそのまま使う）
export const LEVELS = [
  { key: 'closed', label: '全面通行止め', color: '#7a0019' },
  { key: 'alternating', label: '片側交互通行', color: '#e0301e' },
  { key: 'half', label: '3分の1以上ふさぐ', color: '#f07f00' },
  { key: 'part', label: '一部の車線', color: '#f5b700' },
  { key: 'unknown', label: '車線数の記載なし', color: '#6b7c93' },
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

// --- どちら側の車線か（推定）--------------------------------------------
// 工事マップ側 public/roadside.js の移植。読み方は推定:
// 上り＝都心(日本橋)へ向かう車線、内回り＝都心寄り。日本は左側通行なので
// 上り車線は「都心を向いて左側」、内回り車線は「都心に近い側」。
export const CENTER = [139.7740, 35.6840];   // 日本橋（道路元標）

export function sideKind(code) {
  const s = String(code || '');
  const up = s.includes('上'), down = s.includes('下'), inner = s.includes('内'), outer = s.includes('外');
  if ((up && down) || (inner && outer)) return 'both';
  if (up) return 'up';
  if (down) return 'down';
  if (inner) return 'inner';
  if (outer) return 'outer';
  if (s.includes('中')) return 'center';
  return 'unknown';
}

/** 線の向き d（[東, 北]）と中ほど mid から、規制側が線の進む向きの右(+1)か左(-1)か。決まらなければ 0 */
export function offsetSign(code, d, mid) {
  const kind = sideKind(code);
  const k = Math.cos((mid[1] * Math.PI) / 180);
  const toC = [(CENTER[0] - mid[0]) * k, CENTER[1] - mid[1]];
  const dx = d[0], dy = d[1];
  const cos = (dx * toC[0] + dy * toC[1]) / ((Math.hypot(dx, dy) * Math.hypot(toC[0], toC[1])) || 1);
  if (kind === 'up' || kind === 'down') {
    if (Math.abs(cos) < 0.34) return 0;         // 都心に対して横向きの道路は決めない
    const upSign = cos > 0 ? -1 : 1;
    return kind === 'up' ? upSign : -upSign;
  }
  if (kind === 'inner' || kind === 'outer') {
    if (Math.abs(cos) > 0.94) return 0;         // 都心へまっすぐ向かう道路は決めない
    const innerSign = dx * toC[1] - dy * toC[0] > 0 ? -1 : 1;
    return kind === 'inner' ? innerSign : -innerSign;
  }
  return 0;
}

export function sideLabel(code) {
  return {
    up: '上り側（都心へ向かう車線）', down: '下り側（都心から離れる車線）',
    inner: '内回り側（都心寄りの車線）', outer: '外回り側（都心から遠い側の車線）',
    both: '両側の車線', center: '中央の車線', unknown: '記載なし',
  }[sideKind(code)];
}

/** 点（道路の向き bearing 度）を、道路に沿った短い線（約±25m）にする */
export function barAlong(p, bearing, halfM = 25) {
  const r = (bearing * Math.PI) / 180;
  const dLat = (Math.cos(r) * halfM) / 111320;
  const dLng = (Math.sin(r) * halfM) / (111320 * Math.cos((p[1] * Math.PI) / 180));
  return [[p[0] - dLng, p[1] - dLat], [p[0] + dLng, p[1] + dLat]];
}

/**
 * 地図に渡す形にする（工事マップ側 toDisplay の移植）。
 * level=ふさぎ具合 / side=線の左右どちらへ寄せるか / st=2:作業中 1:期間中だが時間外 0:期間外
 */
export function toDisplay(f, timeMs) {
  const p = f.properties || {};
  let g = f.geometry;
  if (g.type === 'Point' && typeof p.roadBearing === 'number') {
    g = { type: 'LineString', coordinates: barAlong(g.coordinates, p.roadBearing) };
  }
  let side = 0;
  if (g.type === 'LineString') {
    const c = g.coordinates, a = c[0], b = c[c.length - 1];
    const k = Math.cos((a[1] * Math.PI) / 180);
    side = offsetSign(p.roadSide, [(b[0] - a[0]) * k, b[1] - a[1]], c[Math.floor(c.length / 2)]);
  }
  const title = String(p.title || '');
  const road = title.split(' ')[0];
  const what = title.split(' ').slice(1).join(' ');
  return {
    type: 'Feature', geometry: g,
    // isLine=1 は元から線の工事（点を線に直したものは0）。矢印の置き方を変えるのに使う
    properties: {
      ...p, level: laneLevel(p), kind: kindOf(p.title), dir: dirOf(p.roadSide),
      road, what, side, st: stateAt(p, timeMs), isLine: f.geometry.type === 'LineString' ? 1 : 0,
    },
  };
}

/**
 * 表示の起点（0時からの「正時」）を「いま」に合わせ直すか。合わせ直すなら新しい起点、不要なら null。
 * アプリを開きっぱなしにすると、起点が開いた時刻のまま止まり、終わった工事が出続けていた。
 *   atNow: 時刻つまみが「いま」（いちばん左）にある
 *   force: アプリに戻ってきた・工事の画面に入り直した（動かしていても「いま」に戻す）
 */
export function nextBase(base, nowMs, { atNow, force = false }) {
  const HOUR = 3600 * 1000;
  const nowBase = Math.floor(nowMs / HOUR) * HOUR;
  if (nowBase === base) return null;
  if (!atNow && !force) return null;
  return nowBase;
}

/** 2=その時刻に作業中 / 1=期間中だが時間外 / 0=期間外 */
export function stateAt(p, t) {
  const { start, end } = periodBounds(p);
  if ((start !== null && t < start) || (end !== null && t > end)) return 0;
  return inWindows(p.timeWindow, t) ? 2 : 1;
}

/** 遠目の「雨雲」用に、線を約150mごとの点にばらす（工事マップ側 samplePoints の移植） */
export function samplePoints(g) {
  if (g.type === 'Point') return [g.coordinates];
  const c = g.coordinates, out = [c[0]];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const k = Math.cos((c[i][1] * Math.PI) / 180);
    acc += Math.hypot((c[i][0] - c[i - 1][0]) * k, c[i][1] - c[i - 1][1]) * 111320;
    if (acc >= 150) { out.push(c[i]); acc = 0; }
  }
  return out;
}

export const HEAT_WEIGHT = { closed: 1, alternating: 0.85, half: 0.6, part: 0.3, unknown: 0.25 };

// --- 工事の種類（件名の後ろ＝都データの「工事内容」から）本家 workkind.js の移植 ---
export const KINDS = [
  { key: 'water', label: '水道', color: '#1f6fd1', re: /^水道|上水/ },
  { key: 'sewer', label: '下水道', color: '#8a5a2b', re: /下水/ },
  { key: 'gas', label: 'ガス', color: '#d62d20', re: /ガス/ },
  { key: 'power', label: '電気', color: '#7b3fe4', re: /電気|電力|電線/ },
  { key: 'telecom', label: '電話・通信', color: '#0f9d8a', re: /電話|通信|光/ },
  { key: 'road', label: '道路・橋', color: '#f07f00', re: /道路|橋|交差点|舗装|歩道|地下道|仮囲い|首都高/ },
  { key: 'other', label: '地下鉄・その他', color: '#d4458f', re: /./ },
];

export function kindOf(title) {
  const t = String(title || '');
  const content = t.includes(' ') ? t.slice(t.indexOf(' ') + 1) : t;
  if (/地下鉄|再開発|軌道|河川|試掘/.test(content) && !/首都高/.test(content)) return 'other';
  return (KINDS.find((k) => k.re.test(content)) || KINDS[KINDS.length - 1]).key;
}
export function kindInfo(key) { return KINDS.find((k) => k.key === key) || KINDS[KINDS.length - 1]; }

// --- 混みやすさの見出し（本家 jam.js の JAMS）---
export const JAMS = [
  { key: 'blocked', label: '通れない', color: '#7a0019' },
  { key: 'high', label: '混みやすい', color: '#e0301e' },
  { key: 'mid', label: 'やや混む', color: '#f07f00' },
  { key: 'low', label: '流れやすい', color: '#1f9d55' },
  { key: 'unknown', label: 'わからない', color: '#9aa0a6' },
];
export function jamInfo(key) { return JAMS.find((j) => j.key === key) || JAMS[JAMS.length - 1]; }

// --- 車の向き（ふさがれる車線を走る車がどちらへ向かうか）本家 DIRS ---
export const DIRS = [
  { key: 'up', label: '都心へ向かう車線', color: '#2f6fd6' },
  { key: 'down', label: '都心から出る車線', color: '#11a37f' },
  { key: 'inner', label: '内回り', color: '#8b5cf6' },
  { key: 'outer', label: '外回り', color: '#db2777' },
  { key: 'both', label: '両側', color: '#7c8490' },
  { key: 'center', label: '中央・記載なし', color: '#b3b8bf' },
];
export const dirOf = (code) => { const k = sideKind(code); return k === 'unknown' ? 'center' : k; };

// 色分けの切り替え（ふさぎ具合／工事の種類／車の向き／混みやすさ）
export const MODES = {
  level: { items: LEVELS, prop: 'level', label: 'ふさぎ具合' },
  kind: { items: KINDS, prop: 'kind', label: '工事の種類' },
  dir: { items: DIRS, prop: 'dir', label: '車の向き' },
  jam: { items: JAMS, prop: 'jam', label: '混みやすさ' },
};

export const TYPE_LABEL = {
  lane_closure: '車線規制', road_closed: '通行止め', alternating_one_way: '片側交互通行',
  sidewalk_closed: '歩道通行止め', sidewalk_narrowed: '歩道狭小', bicycle_lane_closed: '自転車レーン規制',
  turn_restriction: '右左折規制',
};
export const KIND_MARK = { water: '水', sewer: '下', gas: 'ガ', power: '電', telecom: '通', road: '道', other: '他' };
export const SIDE_SHORT = { up: '上り側', down: '下り側', inner: '内回り側', outer: '外回り側', both: '両側', center: '中央' };
export const LEVEL_ORDER = Object.fromEntries(LEVELS.map((l, i) => [l.key, i]));
export const LIST_MAX = 80;

// 地名ラベル（主な駅・街）本家と同じ
export const PLACES = [
  ['東京', 'TOKYO', 139.7671, 35.6812], ['新宿', 'SHINJUKU', 139.7006, 35.6896], ['渋谷', 'SHIBUYA', 139.7016, 35.658],
  ['池袋', 'IKEBUKURO', 139.7109, 35.7295], ['上野', 'UENO', 139.7774, 35.7141], ['品川', 'SHINAGAWA', 139.7387, 35.6285],
  ['銀座', 'GINZA', 139.7671, 35.6717], ['六本木', 'ROPPONGI', 139.731, 35.6628], ['浅草', 'ASAKUSA', 139.7967, 35.7119],
  ['錦糸町', 'KINSHICHO', 139.814, 35.6962], ['北千住', 'KITA-SENJU', 139.8048, 35.7497], ['赤羽', 'AKABANE', 139.721, 35.7777],
  ['練馬', 'NERIMA', 139.6545, 35.7377], ['中野', 'NAKANO', 139.6657, 35.7056], ['荻窪', 'OGIKUBO', 139.62, 35.7047],
  ['二子玉川', 'FUTAKO-TAMAGAWA', 139.6268, 35.6116], ['目黒', 'MEGURO', 139.7157, 35.6339], ['蒲田', 'KAMATA', 139.716, 35.5625],
  ['豊洲', 'TOYOSU', 139.796, 35.6549], ['葛西', 'KASAI', 139.8726, 35.6636], ['亀有', 'KAMEARI', 139.8474, 35.7662],
  ['王子', 'OJI', 139.7381, 35.7527], ['成増', 'NARIMASU', 139.6327, 35.7778], ['大井町', 'OIMACHI', 139.7346, 35.6065],
];

/** 期間の表示（本家 period.js）。都データは月単位 */
export function formatPeriod(r) {
  const isTokyo2 = r.source === 'tokyo_kensetsu' || (typeof r.id === 'string' && r.id.startsWith('tokyo-'));
  const fmtMonth = (d) => {
    const m = String(d || '').match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}年${Number(m[2])}月` : '未定';
  };
  const fmtDay = (d) => {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : '未定';
  };
  return isTokyo2 ? `${fmtMonth(r.startAt)} 〜 ${fmtMonth(r.endAt)}（月単位）` : `${fmtDay(r.startAt)} 〜 ${fmtDay(r.endAt)}`;
}

/** いま入っている作業時間の枠（終わりまでの分・進み具合）。時間帯の記載が無ければ null */
export function windowAt(tw, t) {
  const m = jstMinutes(t);
  for (const { s, e } of parseWindows(tw)) {
    const len = (e - s + 1440) % 1440 || 1440;
    const done = (m - s + 1440) % 1440;
    if (done < len) return { end: e, left: len - done, frac: done / len };
  }
  return null;
}

/** 位置が目安の工事に「双子」（道路名だけ違う同じ内容の工事）があれば印を付ける（本家 markTwins） */
export function markTwins(fs) {
  const pts = (g) => (g.type === 'Point' ? [g.coordinates] : g.coordinates);
  const nearM = (a, b) => {
    const k = Math.cos((a[1] * Math.PI) / 180) * 111320;
    return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 111320);
  };
  for (const f of fs) {
    const p = f.properties;
    if (p.placement !== 'approx') continue;
    const here = pts(f.geometry)[0];
    const twin = fs.find((o) => {
      const q = o.properties;
      return o !== f && q.placement !== 'approx' && q.road !== p.road && q.what === p.what
        && (q.roadSide ?? '') === (p.roadSide ?? '') && q.lanesRestricted === p.lanesRestricted
        && q.lanesTotal === p.lanesTotal && (q.timeWindow ?? '') === (p.timeWindow ?? '')
        && pts(o.geometry).some((c) => nearM(c, here) <= 400);
    });
    if (twin) p.twinRoad = twin.properties.road;
  }
}

// --- 道の持ち主（国道・都道・区道）と区の名前。本家 roadowner.js の移植 ---
export const OWNERS_DEF = [
  { key: 'kokudo', rdctg: '国道', label: '国道', color: '#2563eb', width: [1.6, 7], minzoom: 8 },
  { key: 'todo', rdctg: '都道府県道', label: '都道', color: '#059669', width: [1.2, 5.5], minzoom: 10 },
  { key: 'kudo', rdctg: '市区町村道等', label: '区道など', color: '#c026d3', width: [0.6, 2.2], minzoom: 14, opacity: 0.45 },
];
export const WARDS_DEF = [
  ['千代田区', 139.7387, 35.6894], ['中央区', 139.7821, 35.6779], ['港区', 139.7275, 35.6552], ['新宿区', 139.7097, 35.6995],
  ['文京区', 139.739, 35.72], ['台東区', 139.7859, 35.7205], ['墨田区', 139.8115, 35.7162], ['江東区', 139.8072, 35.6766],
  ['品川区', 139.7143, 35.613], ['目黒区', 139.6933, 35.6392], ['大田区', 139.7073, 35.5798], ['世田谷区', 139.6284, 35.638],
  ['渋谷区', 139.683, 35.6679], ['中野区', 139.6707, 35.7195], ['杉並区', 139.6227, 35.6928], ['豊島区', 139.692, 35.7362],
  ['北区', 139.7294, 35.7758], ['荒川区', 139.7636, 35.7451], ['板橋区', 139.6828, 35.7819], ['練馬区', 139.6209, 35.7619],
  ['足立区', 139.8024, 35.7854], ['葛飾区', 139.8492, 35.7417], ['江戸川区', 139.8724, 35.6987],
];

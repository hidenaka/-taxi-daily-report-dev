// 雨雲レーダーの材料づくり（DOM非依存の純関数のみ）
//
// データ元: 気象庁 高解像度降水ナウキャスト(hrpns)のタイル。
// 気象庁ホームページのコンテンツは政府標準利用規約準拠で、出典明示のうえ自由に使える。
// 画面に「出典：気象庁」を必ず出すこと。
//
//   実況 targetTimes_N1.json … 過去3時間・5分刻み(37コマ)
//   予測 targetTimes_N2.json … 1時間先まで・5分刻み
//   タイル /nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png
//
// 時刻は UTC の 'YYYYMMDDHHmmss'。画面に出すときは必ず日本時間へ直す。

const BASE = 'https://www.jma.go.jp/bosai/jmatile/data/nowc';
export const TARGET_TIMES_OBS = `${BASE}/targetTimes_N1.json`;
export const TARGET_TIMES_FCST = `${BASE}/targetTimes_N2.json`;
// 降水短時間予報。ナウキャストの先(1〜15時間先・1時間刻み)を埋める。
const SHORT_BASE = 'https://www.jma.go.jp/bosai/jmatile/data/rasrf';
export const TARGET_TIMES_SHORT = `${SHORT_BASE}/targetTimes.json`;

// 気象庁の 'YYYYMMDDHHmmss'(UTC) → ミリ秒。読めなければ null。
export function parseJmaTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

// 実況(N1)と予測(N2)を1本のコマ列にする。古い順。
// 同じ時刻が両方にあれば実況を採る(実際に降った記録のほうが確かなため)。
// isLatestObs: 実況の最新コマ＝スライダーの「いま」の位置。
export function buildFrames(obsList, fcstList) {
  const pick = (list, kind) => (Array.isArray(list) ? list : [])
    .map((x) => ({
      basetime: x?.basetime, validtime: x?.validtime, kind, product: 'hrpns',
      timeMs: parseJmaTime(x?.validtime),
    }))
    .filter((f) => f.basetime && f.validtime && f.timeMs !== null);

  const byTime = new Map();
  for (const f of pick(fcstList, 'fcst')) byTime.set(f.validtime, f);
  for (const f of pick(obsList, 'obs')) byTime.set(f.validtime, f); // 実況で上書き＝優先
  const frames = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);

  let latestObs = null;
  for (const f of frames) { if (f.kind === 'obs') latestObs = f; }
  return frames.map((f) => ({ ...f, isLatestObs: f === latestObs }));
}

export function tileUrl(frame, z, x, y) {
  const root = frame.product === 'rasrf' ? SHORT_BASE : BASE;
  const kind = frame.product === 'rasrf' ? 'rasrf' : 'hrpns';
  return `${root}/${frame.basetime}/none/${frame.validtime}/surf/${kind}/${z}/${x}/${y}.png`;
}

// そのコマの時刻(日本時間 HH:MM)
export function frameClock(frame) {
  if (!frame || frame.timeMs == null) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).format(new Date(frame.timeMs));
}

// 「いま」からどれだけ離れたコマか。乗務中に一目で分かる言い方にする。
export function frameLabel(frame, nowMs) {
  if (!frame || frame.timeMs == null || nowMs == null) return '';
  const diffMin = Math.round((frame.timeMs - nowMs) / 60000);
  if (diffMin === 0) return 'いま';
  const abs = Math.abs(diffMin);
  // 15時間先まで出せるので、1時間を超えたら「◯時間◯分」にする。
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const unit = h === 0 ? `${m}分` : (m === 0 ? `${h}時間` : `${h}時間${m}分`);
  return diffMin < 0 ? `${unit}前` : `${unit}後`;
}

// --- 場所えらび -----------------------------------------------------------
// 開いてすぐ選べる場所。乗務でよく行くところ。
export const PRESET_PLACES = [
  { name: '羽田空港', lat: 35.5494, lon: 139.7798 },
  { name: '東京駅', lat: 35.6812, lon: 139.7671 },
  { name: '新宿', lat: 35.6896, lon: 139.7006 },
  { name: '渋谷', lat: 35.6580, lon: 139.7016 },
  { name: '品川', lat: 35.6285, lon: 139.7387 },
  { name: '銀座', lat: 35.6717, lon: 139.7650 },
];

// 地名で探す。js/data/area-coords.json（町名→[緯度,経度]）をそのまま渡す。
// 前が一致するものを先に、次に短い名前を先に出す(「羽田」で「大田区羽田」が先頭に来る)。
export function searchPlaces(query, coords, limit = 20) {
  const q = String(query ?? '').trim();
  if (!q || !coords) return [];
  const hits = [];
  for (const [name, ll] of Object.entries(coords)) {
    if (!name.includes(q)) continue;
    if (!Array.isArray(ll) || ll.length < 2) continue;
    hits.push({ name, lat: ll[0], lon: ll[1], head: name.indexOf(q) });
  }
  hits.sort((a, b) => {
    // 「羽田」と打ったとき、町名がそのまま羽田で終わるものを優先
    const aEnd = a.name.endsWith(q) ? 0 : 1;
    const bEnd = b.name.endsWith(q) ? 0 : 1;
    if (aEnd !== bEnd) return aEnd - bEnd;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name, 'ja');
  });
  return hits.slice(0, limit).map(({ name, lat, lon }) => ({ name, lat, lon }));
}

// ナウキャスト(5分刻み・1時間先まで)の続きに、降水短時間予報を足す。
//
// 短時間予報の時刻一覧は、基準時刻ちがいの同じ予報時刻がたくさん並ぶ。
//   ・10分ごとに更新される基準時刻 … 1〜6時間先
//   ・毎正時の基準時刻            … 7〜15時間先
// 同じ予報時刻が複数あるので、いちばん新しい基準時刻のものを採る。
// 過去ぶん(解析)も混ざっているので、ナウキャストの最後より先だけを使う。
// 重なる時間帯は、細かいナウキャスト(5分刻み)を残す。
export function buildFramesWithShortRange(obsList, fcstList, shortList) {
  const base = buildFrames(obsList, fcstList);
  const rows = Array.isArray(shortList) ? shortList : [];
  if (rows.length === 0) return base;

  const lastMs = base.length ? base[base.length - 1].timeMs : null;
  const taken = new Set(base.map((f) => f.validtime));

  // 予報時刻ごとに、いちばん新しい基準時刻を選ぶ
  const newest = new Map();
  for (const x of rows) {
    const timeMs = parseJmaTime(x?.validtime);
    if (!x?.basetime || !x?.validtime || timeMs === null) continue;
    if (lastMs !== null && timeMs <= lastMs) continue;   // ナウキャストで足りている範囲
    if (taken.has(x.validtime)) continue;
    const cur = newest.get(x.validtime);
    if (!cur || x.basetime > cur.basetime) {
      newest.set(x.validtime, { basetime: x.basetime, validtime: x.validtime, timeMs });
    }
  }

  const extra = [...newest.values()]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((f) => ({ ...f, kind: 'fcst', product: 'rasrf', isLatestObs: false }));

  return [...base, ...extra];
}

// --- 時間バーの目盛り -----------------------------------------------------
// コマ番号で等間隔に並べると、過去3時間(5分刻み37コマ)が幅の6割を占め、
// 先の13時間(1時間刻み)が2割という、時間の長さと合わない見た目になっていた。
// バーの位置は「先頭のコマからの経過分」で決める。

// 各コマが先頭から何分の位置か、バー上の%はいくつか。
export function frameOffsets(frames) {
  const rows = Array.isArray(frames) ? frames : [];
  if (rows.length === 0) return { minutes: [], percents: [], totalMin: 0 };
  const base = rows[0].timeMs;
  const minutes = rows.map((f) => Math.round((f.timeMs - base) / 60000));
  const totalMin = minutes[minutes.length - 1];
  const percents = minutes.map((m) => (totalMin > 0 ? (m / totalMin) * 100 : 0));
  return { minutes, percents, totalMin };
}

// バー上の位置(先頭からの分)から、いちばん近いコマ番号を返す。
export function nearestFrameIndex(frames, minutes) {
  const rows = Array.isArray(frames) ? frames : [];
  if (rows.length === 0) return -1;
  const base = rows[0].timeMs;
  let best = 0;
  let bestDiff = Infinity;
  rows.forEach((f, i) => {
    const d = Math.abs((f.timeMs - base) / 60000 - minutes);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return best;
}

// 目盛り。
// 先(未来)は1時間おき。「何時のことか」がそのまま読めるように時計で出す(JST)。
// 過去は3時間ぶんしかないので3時間おき(左端の「3時間前」だけ)。
export const TICK_PAST_STEP_MIN = 180;

const HOUR_MS = 3600000;

function jstHourLabel(ms) {
  // ja-JP の hour:'numeric' は既に「11時」の形で返る。'時' を足すと二重になる。
  const h = new Intl.DateTimeFormat('ja-JP', {
    hour: 'numeric', hour12: false, timeZone: 'Asia/Tokyo',
  }).format(new Date(ms));
  return h.endsWith('時') ? h : `${h}時`;
}

export function buildTicks(frames) {
  const rows = Array.isArray(frames) ? frames : [];
  if (rows.length < 2) return [];
  const nowFrame = rows.find((f) => f.isLatestObs) || rows[0];
  const nowMs = nowFrame.timeMs;
  const first = rows[0].timeMs;
  const last = rows[rows.length - 1].timeMs;
  const span = last - first;
  if (span <= 0) return [];

  const ticks = [];
  const push = (ms, label, kind) => {
    if (ms < first - 60000 || ms > last + 60000) return;
    const pct = Math.min(100, Math.max(0, ((ms - first) / span) * 100));
    ticks.push({ label, pct, ms, kind });
  };

  // 過去側(3時間おき)
  const pastMin = Math.floor((nowMs - first) / 60000 / TICK_PAST_STEP_MIN) * TICK_PAST_STEP_MIN;
  for (let m = pastMin; m > 0; m -= TICK_PAST_STEP_MIN) {
    push(nowMs - m * 60000, `${m / 60}時間前`, 'past');
  }
  push(nowMs, 'いま', 'now');

  // 先側(1時間おき)。「10:15のいま」なら 11時 12時 … と、ちょうどの時刻に置く。
  const firstHour = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  for (let ms = firstHour; ms <= last + 60000; ms += HOUR_MS) {
    if (ms <= nowMs) continue;
    push(ms, jstHourLabel(ms), 'future');
  }
  return ticks;
}

// --- その場所の雨の強さ（時刻バーの色分け用） ---------------------------------
// 気象庁のタイルは、雨の強さが決まった色で塗られている。
// 実測した色（2026-09-13 実タイルから全画素を数えて確認）:
//   透明        … 雨なし
//   242,242,255 … 0.1〜1 mm/h
//   160,210,255 … 1〜5
//   33,140,255  … 5〜10
//   0,65,255    … 10〜20
//   250,245,0   … 20〜30
//   255,153,0   … 30〜50
//   255,40,0    … 50〜80
//   180,0,104   … 80以上
export const RAIN_LEVELS = [
  { rgb: [242, 242, 255], label: '0.1〜1', css: 'rgb(242,242,255)' },
  { rgb: [160, 210, 255], label: '1〜5', css: 'rgb(160,210,255)' },
  { rgb: [33, 140, 255], label: '5〜10', css: 'rgb(33,140,255)' },
  { rgb: [0, 65, 255], label: '10〜20', css: 'rgb(0,65,255)' },
  { rgb: [250, 245, 0], label: '20〜30', css: 'rgb(250,245,0)' },
  { rgb: [255, 153, 0], label: '30〜50', css: 'rgb(255,153,0)' },
  { rgb: [255, 40, 0], label: '50〜80', css: 'rgb(255,40,0)' },
  { rgb: [180, 0, 104], label: '80〜', css: 'rgb(180,0,104)' },
];

// 画像の圧縮などで色が少しずれることがあるので、近ければ同じ段とみなす。
// どの段からも遠い色（表に無い色）は雨なし扱いにする。
const RAIN_MATCH_MAX = 60 * 60;   // 各成分20ずれ相当まで

// 画素の色 → 雨の強さの段(0〜7)。雨なしは -1。
export function rainLevelFromPixel(r, g, b, a) {
  if (!a) return -1;
  let best = -1;
  let bestDist = Infinity;
  RAIN_LEVELS.forEach((lv, i) => {
    const d = (lv.rgb[0] - r) ** 2 + (lv.rgb[1] - g) ** 2 + (lv.rgb[2] - b) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return bestDist <= RAIN_MATCH_MAX ? best : -1;
}

// 緯度経度 → タイル番号と、そのタイルの中の画素位置
export function pointTile(lat, lon, z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const la = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return {
    x, y,
    px: Math.min(255, Math.max(0, Math.floor((fx - x) * 256))),
    py: Math.min(255, Math.max(0, Math.floor((fy - y) * 256))),
  };
}

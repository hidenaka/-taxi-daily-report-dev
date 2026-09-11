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

// 警視庁の交通量調査地点（公式 CSV には緯度経度が無い）の位置を、OpenStreetMap の情報で確かめる（手動で実行）。
//
// 使い方（手順の全体は docs/roadwork/keishicho-traffic-counts.md）:
//   node .github/scripts/locate-keishicho-points.mjs --zip <公式ZIP> --signals <OSMの名前付き信号.json> --checked-at 2026-10-22
//
// 決め方（交差点名と交差道路名だけから座標を推定しない）:
//   1. OSM で「その交差点名」が付いた信号・交差点の点を探す
//   2. その点から 45m 以内に、交差道路名の2本の道路（OSM の道路名）が両方あり、
//      その2本が点から 60m 以内で交わっているときだけ「確認済み（OSM の自動照合）」
//      → coordinateStatus = 'verified-osm'
//   3. 名前の点が無い・道路が合わない地点は、2本の道路が交わる所を「候補」として書き出すだけ
//      → coordinateStatus = 'candidate-roads'（地図には出さない。航空写真で目で確かめたら visual へ）
//   4. 目で確かめた結果（--visual のファイル）があれば、それを優先する
//      → 'verified-visual'（地図に出す）／ 'mismatch'（出さない）
// 出力: .github/scripts/data/keishicho-coords-r6.json（build-keishicho-traffic-counts.mjs が読む）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { groupCsvFiles, stableJson } from './build-keishicho-traffic-counts.mjs';
import { readZip } from './lib/read-zip.mjs';
import { buildPoint } from '../../tools/js/traffic-count-data.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
export const NEAR_M = 45;          // 交差点の点から道路までの許容距離
export const CROSS_M = 20;         // 2本の道路が「交わる」とみなす距離（候補づくり用）
export const CROSS_NEAR_M = 60;    // 名前の点から、2本の道路が交わる所までの許容距離

const nfkc = (s) => String(s ?? '').normalize('NFKC').replace(/\s/g, '');
const KAN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };

/** 交差点名の言い換え（'赤坂1' → '赤坂一' '赤坂1丁目' など。OSM 側の書き方の違いを吸収） */
export function nameKeys(name) {
  const b = nfkc(name);
  const keys = [b, `${b}交差点`];
  const m = b.match(/^(.*?)(\d)$/);
  if (m) keys.push(m[1] + KAN[m[2]], `${m[1]}${m[2]}丁目`, `${m[1]}${KAN[m[2]]}丁目`);
  return [...new Set(keys)];
}

// 交差道路名 → OSM の道路名に含まれる文字列（どれか1つでも含めば同じ道路とみなす）
const ROAD_ALIASES = {
  中仙道: ['中山道', '中仙道'],
  湾岸道路: ['湾岸道路'],
  環状二号線: ['環状2号線', '環状第2号線', '環二通り', '環状二号線'],
  東京港臨海道路: ['東京港臨海道路', '臨海道路'],
};
/** 交差道路名から探す名前の一覧。番号だけの道路名など確かめようがないものは null */
export function roadKeys(road) {
  const r = nfkc(road).replace(/[（）()]/g, '');
  if (!r || /^\d+$/.test(r) || r === '臨港道路' || /^都道\d+号$/.test(r) || /^放射第?\d+号$/.test(r)) return null;
  return ROAD_ALIASES[r] || [r];
}

const M_LAT = 111320;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** 点 p と線分 a-b の距離（m） */
export function distToSeg(p, a, b) {
  const k = mLon(p[1]);
  const ax = (a[0] - p[0]) * k; const ay = (a[1] - p[1]) * M_LAT;
  const bx = (b[0] - p[0]) * k; const by = (b[1] - p[1]) * M_LAT;
  const dx = bx - ax; const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function lines(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

/** 道路の線の一覧から、名前が keys のどれかを含む線だけを取り出す */
export function roadLines(roads, keys) {
  const out = [];
  for (const f of roads) {
    const n = nfkc(f.properties?.n ?? f.properties?.name ?? '');
    if (n && keys.some((k) => n.includes(k))) out.push(...lines(f.geometry));
  }
  return out;
}

export function nearestDist(p, ls) {
  let best = Infinity;
  for (const c of ls) for (let i = 0; i + 1 < c.length; i += 1) best = Math.min(best, distToSeg(p, c[i], c[i + 1]));
  return best;
}

/** 線分 a-b と c-d が交わる点（経度・緯度）。交わらなければ null */
export function segIntersection(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (den === 0) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** 2本の道路が交わる所・近づく所（候補）を、200m 以内をひとまとめにして返す */
export function crossingCandidates(la, lb) {
  const pts = [];
  for (const c of la) {
    for (const p of c) if (nearestDist(p, lb) <= CROSS_M) pts.push(p);
    for (let i = 0; i + 1 < c.length; i += 1) {
      for (const e of lb) {
        for (let j = 0; j + 1 < e.length; j += 1) {
          const x = segIntersection(c[i], c[i + 1], e[j], e[j + 1]);
          if (x) pts.push(x);
        }
      }
    }
  }
  const groups = [];
  for (const p of pts) {
    const g = groups.find((x) => Math.hypot((x.c[0] - p[0]) * mLon(p[1]), (x.c[1] - p[1]) * M_LAT) < 200);
    if (g) { g.pts.push(p); g.c = [g.pts.reduce((s, q) => s + q[0], 0) / g.pts.length, g.pts.reduce((s, q) => s + q[1], 0) / g.pts.length]; } else groups.push({ c: p, pts: [p] });
  }
  return groups.map((g) => g.c);
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** 1地点の位置を決める（純粋な部分） */
export function locatePoint(pt, { signalIndex, roads, checkedAt }) {
  const [ra, rb] = pt.crossRoads;
  const ka = roadKeys(ra); const kb = roadKeys(rb);
  const la = ka ? roadLines(roads, ka) : [];
  const lb = kb ? roadLines(roads, kb) : [];
  const cands = [];
  for (const k of nameKeys(pt.name)) for (const s of signalIndex.get(k) || []) cands.push(s);
  const ok = [];
  for (const s of cands) {
    const p = [s.lon, s.lat];
    const da = la.length ? nearestDist(p, la) : Infinity;
    const db = lb.length ? nearestDist(p, lb) : Infinity;
    if (da <= NEAR_M && db <= NEAR_M) ok.push({ s, da, db });
  }
  if (ok.length) {
    const c0 = ok[0].s;
    const near = ok.filter((o) => Math.hypot((o.s.lon - c0.lon) * mLon(c0.lat), (o.s.lat - c0.lat) * M_LAT) < 150);
    if (near.length !== ok.length) {
      return { coordinateStatus: 'mismatch', coordinateCheckedAt: checkedAt, note: `同じ名前で両方の道路に近い点が離れて ${ok.length} か所ある` };
    }
    const lat = near.reduce((s, o) => s + o.s.lat, 0) / near.length;
    const lon = near.reduce((s, o) => s + o.s.lon, 0) / near.length;
    // 2本の道路が、その点の近く（CROSS_NEAR_M 以内）で本当に交わっていること（並行する道路で通らないように）
    const xs = crossingCandidates(la, lb);
    const dx = Math.min(Infinity, ...xs.map((c) => Math.hypot((c[0] - lon) * mLon(lat), (c[1] - lat) * M_LAT)));
    if (!(dx <= CROSS_NEAR_M)) {
      return { lat: r6(lat), lon: r6(lon), coordinateStatus: 'candidate-roads', coordinateCheckedAt: checkedAt, note: `名前の点の近くに2本の道路はあるが、交わる所が ${CROSS_NEAR_M}m 以内に見つからない（要・目視）` };
    }
    return {
      lat: r6(lat), lon: r6(lon),
      coordinateStatus: 'verified-osm',
      coordinateCheckedAt: checkedAt,
      coordinateSource: `OpenStreetMap: 交差点名「${pt.name}」の信号・交差点の点（${near.map((o) => `node/${o.s.id}`).join(', ')}）。${NEAR_M}m以内に「${ra}」「${rb}」の道路（OSMの道路名）があることを確認`,
    };
  }
  // 名前で決められない: 2本の道路が交わる所を候補として残す（地図には出さない）
  const note = [];
  if (!cands.length) note.push('OSM に同じ名前の信号・交差点の点が無い');
  else note.push(`同じ名前の点はあるが、${NEAR_M}m以内に2本の道路がそろわない`);
  if (!ka || !kb) note.push('交差道路名の一方が OSM の道路名で確かめられない書き方');
  const xs = la.length && lb.length ? crossingCandidates(la, lb) : [];
  if (xs.length === 1) {
    return { lat: r6(xs[0][1]), lon: r6(xs[0][0]), coordinateStatus: 'candidate-roads', coordinateCheckedAt: checkedAt, note: `${note.join('。')}。2本の道路が交わる所が1か所あり、候補として残す（要・目視）` };
  }
  return { coordinateStatus: 'unplaced', coordinateCheckedAt: checkedAt, note: `${note.join('。')}。道路が交わる候補 ${xs.length} か所` };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function main() {
  const zip = arg('zip');
  const signalsPath = arg('signals');
  const checkedAt = arg('checked-at');
  const roadsPath = resolve(arg('roads', `${ROOT}/tools/lanes/lanes23.geojson`));
  const visualPath = resolve(arg('visual', `${ROOT}/.github/scripts/data/keishicho-visual-checks.json`));
  const outPath = resolve(arg('out', `${ROOT}/.github/scripts/data/keishicho-coords-r6.json`));
  if (!zip || !signalsPath || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt || '')) {
    console.error('使い方: node .github/scripts/locate-keishicho-points.mjs --zip <ZIP> --signals <OSM.json> --checked-at YYYY-MM-DD');
    process.exit(2);
  }
  const { byPoint } = groupCsvFiles(readZip(readFileSync(zip)));
  const osm = JSON.parse(readFileSync(signalsPath, 'utf8'));
  const signalIndex = new Map();
  for (const e of osm.elements || []) {
    if (e.type !== 'node') continue;
    for (const k of ['name', 'name:ja']) {
      const n = e.tags?.[k];
      if (!n) continue;
      const key = nfkc(n);
      if (!signalIndex.has(key)) signalIndex.set(key, []);
      if (!signalIndex.get(key).some((x) => x.id === e.id)) signalIndex.get(key).push({ id: e.id, lat: e.lat, lon: e.lon });
    }
  }
  const roads = JSON.parse(readFileSync(roadsPath, 'utf8')).features || [];
  const visual = existsSync(visualPath) ? JSON.parse(readFileSync(visualPath, 'utf8')).points || {} : {};
  const points = {};
  const tally = {};
  for (const id of [...byPoint.keys()].sort((a, b) => a - b)) {
    const pt = buildPoint({ houkou: byPoint.get(id).houkou.text }).point;
    let r = locatePoint(pt, { signalIndex, roads, checkedAt });
    const v = visual[String(id)];
    if (v) {
      // 目で確かめた結果を優先する（位置を直したときは v の緯度経度を使う）
      r = {
        lat: v.lat ?? r.lat, lon: v.lon ?? r.lon,
        coordinateStatus: v.status,
        coordinateCheckedAt: v.checkedAt,
        coordinateSource: v.status === 'verified-visual' ? `${v.source}${r.coordinateSource ? `／自動照合: ${r.coordinateSource}` : ''}` : undefined,
        note: v.note,
      };
    }
    points[String(id)] = { name: pt.name, crossRoads: pt.crossRoadsRaw, ...Object.fromEntries(Object.entries(r).filter(([, x]) => x !== undefined)) };
    tally[r.coordinateStatus] = (tally[r.coordinateStatus] || 0) + 1;
  }
  const doc = {
    meta: {
      method: 'locate-keishicho-points.mjs（OSM の交差点名の点＋道路名の照合。目視の結果を優先）',
      osmSource: '© OpenStreetMap contributors（ODbL）。Overpass API で取得した東京都内の名前付き信号・交差点の点',
      osmTimestamp: osm.osm3s?.timestamp_osm_base || null,
      roads: 'tools/lanes/lanes23.geojson（OSM 由来の道路の線と名前）',
      checkedAt,
      tally,
    },
    points,
  };
  writeFileSync(outPath, stableJson(doc));
  console.log(tally);
  console.log(`→ ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();

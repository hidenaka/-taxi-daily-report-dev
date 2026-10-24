// 工事ごとに、まわりの道の形（信号・カーブ・坂）を足す（sync-koji.mjs から呼ぶ）
//
// 材料:
//   信号・橋・トンネル: .github/scripts/data/osm-road-features-23.json（OSM の写し。更新は docs/roadwork/koji-road-shape.md）
//   道の線（カーブ）:   tools/lanes/lanes23.geojson（OSM の幹線道路）
//   標高（坂）:         国土地理院 標高タイル dem5a（5m メッシュ）。取れなければ坂だけ出さない
// どれかが失敗しても、工事のデータそのものは出す（足せた値だけ足す）。
import { readFileSync } from 'node:fs';
import { readPng } from './read-png.mjs';
import {
  localFrame, axisOf, signalsAlong, curveFromPoints, roadPointsNear, roadProfile, curveFromProfile, towardPlace, slopeFromProfile, onStructure, demValue, demTileOf,
} from './road-shape.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const DEM = (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`;
const MAIN = new Set(['tr', 'pr', 'se', 'te']);

export function loadRoadData(root = ROOT) {
  const osm = JSON.parse(readFileSync(`${root}.github/scripts/data/osm-road-features-23.json`, 'utf8'));
  const g = JSON.parse(readFileSync(`${root}tools/lanes/lanes23.geojson`, 'utf8'));
  const lines = [];
  for (const f of g.features) {
    const h = f.properties.h;
    if (h === 'mo' || h === 'mol') continue;   // 首都高は下道の形ではない
    const cs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const c of cs) lines.push({ n: f.properties.n || '', main: MAIN.has(h), c });
  }
  return { signals: osm.signals, structures: osm.structures, lines };
}

async function defaultFetchTile(z, x, y) {
  const res = await fetch(DEM(z, x, y), { headers: { 'user-agent': 'cabis-koji-sync' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;    // 海など、標高の無い所
  if (!res.ok) throw new Error(`標高タイル ${res.status}`);
  return readPng(Buffer.from(await res.arrayBuffer()));
}

/**
 * features の properties に axisDeg / axisTo / axisFrom / sigAt / curveDeg / roadU / slopePct を足す（その場で書き換える）。
 * @returns 足せた件数
 */
export async function addRoadShape(features, { data = loadRoadData(), fetchTile = defaultFetchTile, concurrency = 6 } = {}) {
  const jobs = [];
  for (const f of features) {
    const ax = axisOf(f);
    if (!ax) continue;
    const frame = localFrame(ax.mid, ax.bearing);
    const p = f.properties;
    // 道の向き（線の始点→終点・点は roadBearing）と、その先・反対の先にある主な街（絵で「◯◯方面」と出す）
    p.axisDeg = Math.round(ax.bearing) % 360;
    const to = towardPlace(ax.mid, ax.bearing); const from = towardPlace(ax.mid, ax.bearing + 180);
    if (to) p.axisTo = to; else delete p.axisTo;
    if (from) p.axisFrom = from; else delete p.axisFrom;
    const sig = signalsAlong(frame, data.signals);
    if (sig.length) p.sigAt = sig.join(',');
    const road = String(p.title || '').split(' ')[0];
    // 角度は、絵に描く道の形から測れればそれを使う（絵とことばを合わせる）
    const prof = roadProfile(frame, data.lines, road);
    if (prof) p.roadU = prof.map((v) => (v == null ? '' : v)).join(',');
    const curve = (prof && curveFromProfile(prof)) ?? curveFromPoints(roadPointsNear(frame, data.lines, road));
    if (curve != null) p.curveDeg = curve;
    if (!onStructure(frame, data.structures)) {
      const pts = [];
      for (let t = -100; t <= 100; t += 20) pts.push({ t, ll: frame.toLonLat(t) });
      jobs.push({ p, pts });
    }
  }

  // 標高タイルをまとめて取る
  const need = new Map();
  for (const j of jobs) for (const q of j.pts) { const k = demTileOf(...q.ll); q.k = `${k.x}/${k.y}`; q.px = k.px; q.py = k.py; need.set(q.k, k); }
  const tiles = new Map(); let failed = 0;
  const keys = [...need.keys()];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < keys.length) {
      const key = keys[next++]; const k = need.get(key);
      try { tiles.set(key, await fetchTile(15, k.x, k.y)); } catch { failed += 1; tiles.set(key, null); }
    }
  }));
  for (const j of jobs) {
    const samples = j.pts.map((q) => {
      const im = tiles.get(q.k);
      return { t: q.t, z: im ? demValue(...im.rgb(q.px, q.py)) : null };
    });
    const s = slopeFromProfile(samples);
    if (s != null) j.p.slopePct = s;
  }
  const n = (k) => features.filter((f) => f.properties[k] != null).length;
  return { signals: n('sigAt'), curves: n('curveDeg'), profiles: n('roadU'), slopes: n('slopePct'), tiles: keys.length, failedTiles: failed };
}

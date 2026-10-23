// 警視庁の交通量調査地点で、流入方向（A・B・C…）が地図のどちらを向くかを決める（手動で実行）。
//
// 使い方（手順の全体は docs/roadwork/keishicho-traffic-counts.md）:
//   node .github/scripts/locate-keishicho-arms.mjs
//   （先に build-keishicho-traffic-counts.mjs を1回実行して、地図に出す地点の JSON を作っておく。
//     このスクリプトの出力を読んで、もう一度 build を実行すると、地点に向きが入る）
//
// 決め方:
//   1. 交差点から 55m と 90m の円を、OSM の道路の線（tools/lanes/ の lanes23・narrow23）が横切る所を集め、
//      近い向きどうしをまとめて「腕」（交差点から出る道）の向きにする
//   2. 公式 CSV の方向記号は、交差点のまわりを反時計回りに A→B→C… と振ってある
//      （各方向の流出の並びが「左折・直進・右折」の順になっていることから分かる）。
//      そこで、腕を反時計回りに並べ、A をどの腕に置くかだけを、方向の地名（「五反田方面」など）を
//      国土地理院の地名検索で引いた向きと、いちばん合うように選ぶ
//   3. 腕が足りない地点は、地名の向きで補う（virtual）
//   4. 航空写真・地理院地図で目で確かめた結果（--checks のファイル）を優先する。
//      向きを直した地点は bearings を、向きを決められない地点は status: 'unclear' を書く
// 出力: .github/scripts/data/keishicho-arms-r6.json（build-keishicho-traffic-counts.mjs が読む）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stableJson } from './build-keishicho-traffic-counts.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
export const RADII_M = [55, 90];   // 腕の向きを測る円の半径
export const NEAR_M = 35;          // 交差点から、この距離より近くを通る線だけを腕の候補にする
export const MERGE_DEG = 24;       // この角度より近い向きは同じ腕（上下線が分かれた道など）
const WEIGHT = { tr: 4, pr: 3, se: 2.2, te: 1.5, trl: 0.6, prl: 0.6, sel: 0.5, tel: 0.4, narrow: 0.8 };

const brg = (x, y) => ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
export const angleDiff = (a, b) => { const t = Math.abs(a - b) % 360; return t > 180 ? 360 - t : t; };
const projector = (P) => { const k = Math.cos((P.lat * Math.PI) / 180) * 111320; return ([lon, lat]) => [(lon - P.lon) * k, (lat - P.lat) * 110540]; };

/** 道路の線が交差点まわりの円を横切る所の向き（度・北が0の時計回り）と重み */
export function crossings(P, lines, R) {
  const f = projector(P);
  const out = [];
  for (const L of lines) {
    const [lon0, lat0] = L.c[0];
    if (Math.abs(lon0 - P.lon) > 0.03 || Math.abs(lat0 - P.lat) > 0.03) continue;
    const pts = L.c.map(f);
    let near = false;
    for (let i = 0; i < pts.length - 1 && !near; i++) {
      const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; const dx = x2 - x1; const dy = y2 - y1;
      const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy || 1)));
      near = Math.hypot(x1 + t * dx, y1 + t * dy) < NEAR_M;
    }
    if (!near) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; const dx = x2 - x1; const dy = y2 - y1;
      const a = dx * dx + dy * dy; const b = 2 * (x1 * dx + y1 * dy); const c = x1 * x1 + y1 * y1 - R * R;
      const disc = b * b - 4 * a * c;
      if (disc < 0 || !a) continue;
      for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
        if (t >= 0 && t <= 1) out.push({ b: brg(x1 + t * dx, y1 + t * dy), w: L.w });
      }
    }
  }
  return out;
}

/** 近い向きをまとめて腕にする（重みつきの平均の向き） */
export function clusterBearings(items, tol = MERGE_DEG) {
  const s = [...items].sort((a, b) => a.b - b.b);
  const groups = [];
  for (const it of s) {
    const last = groups[groups.length - 1];
    if (last && angleDiff(last[last.length - 1].b, it.b) < tol) last.push(it); else groups.push([it]);
  }
  if (groups.length > 1 && angleDiff(groups[0][0].b, groups[groups.length - 1].at(-1).b) < tol) groups[0].push(...groups.pop());
  return groups.map((g) => {
    let sx = 0; let sy = 0; let w = 0;
    for (const it of g) { sx += Math.sin((it.b * Math.PI) / 180) * it.w; sy += Math.cos((it.b * Math.PI) / 180) * it.w; w += it.w; }
    return { b: brg(sx, sy), w };
  });
}

/** 方向の地名を、交差点から 250m〜15km にある候補のうちいちばん近いものの向きにする */
export function placeBearing(P, candidates = []) {
  const f = projector(P);
  let best = null;
  for (const c of candidates) {
    const [x, y] = f([c.lon, c.lat]); const d = Math.hypot(x, y);
    if (d < 250 || d > 15000) continue;
    if (!best || d < best.d) best = { b: brg(x, y), d };
  }
  return best;
}

/**
 * 方向記号（A・B・C…の順）を腕に割り当てる。
 * arms: [{ code, geo: 地名の向き|null }]（記号の順）、clusters: [{ b, w }]
 * 返り値: { bearings: [度…], virtual: [bool…], err: 地名との平均のずれ } または null
 */
export function assignArms(arms, clusters) {
  const N = arms.length;
  if (!N) return null;
  const top = [...clusters].sort((a, b) => b.w - a.w).slice(0, N).sort((a, b) => b.b - a.b); // 反時計回り＝向きの大きい順
  let best = null;
  const score = (picks) => {
    let err = 0; let n = 0; let pen = 0;
    arms.forEach((a, i) => { const c = picks[i]; if (a.geo) { err += angleDiff(a.geo.b, c.b); n += 1; } pen += c.virtual ? 35 : Math.max(0, 2.5 - c.w) * 6; });
    return { s: (n ? err / n : 60) + pen / N, err: n ? err / n : null };
  };
  // 1) 強い腕がちょうど N 本あれば、どこを A にするかだけ選ぶ
  if (top.length === N && top.every((c) => c.w >= 1.5)) {
    for (let r = 0; r < N; r++) {
      const picks = arms.map((_, i) => top[(i + r) % N]);
      const { s, err } = score(picks);
      if (!best || s < best.s) best = { s, err, picks };
    }
  }
  // 2) そうでなければ、腕の中から N 本を選ぶ（足りない分は地名の向きで補う）
  if (!best) {
    const cands = clusters.map((c) => ({ ...c, virtual: false }));
    for (const a of arms) if (a.geo && cands.every((c) => angleDiff(c.b, a.geo.b) > 25)) cands.push({ b: a.geo.b, w: 0, virtual: true });
    cands.sort((a, b) => b.b - a.b);
    const M = cands.length;
    if (M < N) return null;
    const choose = (start, acc) => {
      if (acc.length === N) {
        for (let r = 0; r < N; r++) {
          const picks = arms.map((_, i) => cands[acc[(i + r) % N]]);
          const { s, err } = score(picks);
          if (!best || s < best.s) best = { s, err, picks };
        }
        return;
      }
      for (let i = start; i < M; i++) choose(i + 1, [...acc, i]);
    };
    choose(0, []);
  }
  return { bearings: best.picks.map((c) => Math.round(c.b) % 360), virtual: best.picks.map((c) => !!c.virtual), err: best.err == null ? null : Math.round(best.err * 10) / 10 };
}

/** 地点の方向記号と地名（流入と流出の両方から、記号の順に） */
export function armCodes(p) {
  const m = new Map();
  for (const a of p.approaches || []) m.set(a.code, a.label);
  for (const e of p.exits || []) if (!m.has(e.code)) m.set(e.code, e.label);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, label]) => ({ code, label }));
}

function loadLines() {
  const lines = [];
  for (const [file, fixed] of [['lanes23', null], ['narrow23', 'narrow']]) {
    const g = JSON.parse(readFileSync(`${ROOT}/tools/lanes/${file}.geojson`, 'utf8'));
    for (const x of g.features) {
      const w = WEIGHT[fixed || x.properties.h];
      if (!w) continue; // 首都高などの自動車専用道は、交差点の腕ではない
      const cs = x.geometry.type === 'LineString' ? [x.geometry.coordinates] : x.geometry.coordinates;
      for (const c of cs) lines.push({ w, c });
    }
  }
  return lines;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function main() {
  const dataPath = resolve(arg('data', `${ROOT}/tools/data/keishicho-traffic-counts.json`));
  const placesPath = resolve(arg('places', `${ROOT}/.github/scripts/data/keishicho-places-r6.json`));
  const checksPath = resolve(arg('checks', `${ROOT}/.github/scripts/data/keishicho-arm-checks.json`));
  const outPath = resolve(arg('out', `${ROOT}/.github/scripts/data/keishicho-arms-r6.json`));
  const doc = JSON.parse(readFileSync(dataPath, 'utf8'));
  const places = JSON.parse(readFileSync(placesPath, 'utf8')).places || {};
  const checks = JSON.parse(readFileSync(checksPath, 'utf8')).points || {};
  const lines = loadLines();
  const points = {};
  const tally = {};
  for (const p of [...doc.points].sort((a, b) => a.pointId - b.pointId)) {
    const arms = armCodes(p).map((a) => ({ ...a, geo: placeBearing(p, places[a.label]) }));
    const clusters = clusterBearings(RADII_M.flatMap((R) => crossings(p, lines, R)));
    const fit = assignArms(arms, clusters);
    const chk = checks[String(p.pointId)];
    const auto = fit ? Object.fromEntries(arms.map((a, i) => [a.code, fit.bearings[i]])) : null;
    let rec;
    if (chk?.status === 'unclear') {
      rec = { status: 'unclear', note: chk.note || '', checkedAt: chk.checkedAt };
    } else if (chk?.status === 'verified-visual') {
      const bearings = { ...(auto || {}), ...(chk.bearings || {}) };
      const missing = arms.filter((a) => !Number.isFinite(bearings[a.code])).map((a) => a.code);
      rec = missing.length
        ? { status: 'unclear', note: `向きが無い方向: ${missing.join('・')}`, checkedAt: chk.checkedAt }
        : { status: 'verified-visual', bearings, corrected: Object.keys(chk.bearings || {}), source: chk.source, checkedAt: chk.checkedAt };
    } else {
      rec = auto ? { status: 'auto', bearings: auto, placeErrDeg: fit.err, virtual: arms.filter((_, i) => fit.virtual[i]).map((a) => a.code) } : { status: 'unclear', note: '腕を決められない' };
    }
    points[p.pointId] = rec;
    tally[rec.status] = (tally[rec.status] || 0) + 1;
  }
  writeFileSync(outPath, stableJson({
    meta: {
      method: '道路の線（OpenStreetMap）で腕の向き、方向記号は反時計回り、A の位置は方向の地名（国土地理院の地名検索）で選び、航空写真・地理院地図で目で確認',
      attribution: '© OpenStreetMap contributors・国土地理院',
      counts: tally,
    },
    points,
  }));
  console.log(`向き: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' / ')}\n→ ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();

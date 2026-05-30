// scripts/lib/road-graph.mjs — 2点をOSM道路網上で最短経路(Dijkstra)で繋ぐ純関数。
// road-router.mjs の routeOnRoadsBetween と同じ signature (a,b,ways,thresh_m)→[a,...,b]|null
// だが「同一way上のみ」ではなく、交差点を跨いで道路網全体を辿る。これにより waypoint 間が
// 直線でショートカットして道を外れる問題を解消する。

function hav(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function nodeKey(p) {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

// ways の頂点をノード、隣接頂点をエッジ(距離重み)とする無向グラフを構築。
// 交差点では座標一致でノードが共有される（Overpass out geom は接続点を同一座標で返す）。
function buildGraph(ways) {
  const adj = new Map(); // key -> { pt:{lat,lng}, edges:[{key,w}] }
  const ensure = (p) => {
    const k = nodeKey(p);
    if (!adj.has(k)) adj.set(k, { pt: { lat: p.lat, lng: p.lng }, edges: [] });
    return k;
  };
  const addEdge = (k1, k2, w) => {
    const bucket = adj.get(k1).edges;
    if (!bucket.some((e) => e.key === k2)) bucket.push({ key: k2, w });
  };
  for (const wway of ways) {
    const g = wway && wway.geometry;
    if (!Array.isArray(g) || g.length < 2) continue;
    let prevK = null; let prevP = null;
    for (const raw of g) {
      const k = ensure(raw);
      if (prevK !== null && prevK !== k) {
        const w = hav(prevP, raw);
        addEdge(prevK, k, w);
        addEdge(k, prevK, w);
      }
      prevK = k; prevP = raw;
    }
  }
  return adj;
}

function nearestNode(adj, p) {
  let bestKey = null; let bestDist = Infinity;
  for (const [k, v] of adj) {
    const d = hav(v.pt, p);
    if (d < bestDist) { bestDist = d; bestKey = k; }
  }
  return { key: bestKey, dist: bestDist };
}

// O(V^2) Dijkstra。半径数百mの周辺道路（ノード数百）には十分。
function dijkstra(adj, srcK, dstK) {
  if (srcK === dstK) return [srcK];
  const dist = new Map([[srcK, 0]]);
  const prev = new Map();
  const visited = new Set();
  for (;;) {
    let u = null; let ud = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < ud) { ud = d; u = k; }
    }
    if (u === null) break;
    if (u === dstK) break;
    visited.add(u);
    for (const e of adj.get(u).edges) {
      if (visited.has(e.key)) continue;
      const nd = ud + e.w;
      if (nd < (dist.has(e.key) ? dist.get(e.key) : Infinity)) {
        dist.set(e.key, nd); prev.set(e.key, u);
      }
    }
  }
  if (!prev.has(dstK)) return null;
  const path = [dstK];
  let cur = dstK;
  while (cur !== srcK) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.push(cur);
  }
  path.reverse();
  return path;
}

// 同じ ways 配列で複数回呼ばれるのでグラフをキャッシュ。
const _graphCache = new WeakMap();
function getGraph(ways) {
  let g = _graphCache.get(ways);
  if (!g) { g = buildGraph(ways); _graphCache.set(ways, g); }
  return g;
}

// 幹線道路クラス（OSM highway）。六本木通り=secondary, 環状3号/外苑東通り=primary。
// 首都高(motorway)は降車導線として不適なので除外。
const ARTERIAL_CLASSES = new Set([
  'trunk', 'primary', 'secondary', 'tertiary',
  'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

function dijkstraMaps(adj, srcK, allowed) {
  const dist = new Map([[srcK, 0]]);
  const prev = new Map();
  const visited = new Set();
  for (;;) {
    let u = null; let ud = Infinity;
    for (const [k, d] of dist) { if (!visited.has(k) && d < ud) { ud = d; u = k; } }
    if (u === null) break;
    visited.add(u);
    for (const e of adj.get(u).edges) {
      if (allowed && !allowed.has(e.key)) continue;
      if (visited.has(e.key)) continue;
      const nd = ud + e.w;
      if (nd < (dist.has(e.key) ? dist.get(e.key) : Infinity)) { dist.set(e.key, nd); prev.set(e.key, u); }
    }
  }
  return { dist, prev };
}

function reconstruct(prev, srcK, dstK, adj) {
  const out = [];
  let cur = dstK;
  while (cur !== undefined) {
    out.push(adj.get(cur).pt);
    if (cur === srcK) break;
    cur = prev.get(cur);
    if (cur === undefined) return null;
  }
  out.reverse();
  return out;
}

function dedupNear(pts, m = 3) {
  const out = [];
  for (const p of pts) {
    if (!out.length || hav(out[out.length - 1], p) > m) out.push(p);
  }
  return out;
}

// 局所メートル変換（lat,lng差をm化）。S付近の小範囲なので等距円筒近似で十分。
function _vecM(from, to) {
  const mlat = 111320;
  const mlng = 111320 * Math.cos((from.lat * Math.PI) / 180);
  return { x: (to.lng - from.lng) * mlng, y: (to.lat - from.lat) * mlat };
}

// 進入線の起点を、approachの「進行方向の逆向き(外側)」にある幹線(primary/secondary)まで
// 道路網沿いに延長する。最寄りを無条件に選ぶと逆方向の幹線へ暴走するので、外側方向への
// 射影が最大の幹線ノードを選ぶ。「幹線→大きい道→入口」を1本で繋いで見せるため。
export function extendToArterial(line, ways, pin, opts = {}) {
  const { maxExtendM = 220, minProjM = 70, threshM = 45 } = opts;
  if (!Array.isArray(line) || line.length < 2 || !pin) return line;
  const adj = getGraph(ways);
  if (adj.size === 0) return line;
  const S = line[0];
  const sNear = nearestNode(adj, S);
  if (!sNear.key || sNear.dist > threshM) return line;

  const artSet = new Set();
  for (const w of ways) {
    if (w && w.tags && ARTERIAL_CLASSES.has(w.tags.highway)) {
      for (const p of (w.geometry || [])) artSet.add(nodeKey(p));
    }
  }
  if (artSet.size === 0) return line;

  // 外側方向 d = 進行(線内へ ~60m 進んだ点 P から S への向き)の逆 = P→S。
  let P = line[1];
  let acc = 0;
  for (let i = 1; i < line.length; i++) { acc += hav(line[i - 1], line[i]); P = line[i]; if (acc >= 60) break; }
  const dv = _vecM(P, S); // P→S（外側）
  const dlen = Math.hypot(dv.x, dv.y) || 1;
  const dx = dv.x / dlen; const dy = dv.y / dlen;

  // 道路網全体で sNear から各ノードへの最短路。外側方向への射影が最大の幹線ノードを選ぶ。
  const full = dijkstraMaps(adj, sNear.key, null);
  let best = null;
  for (const k of artSet) {
    if (!full.dist.has(k)) continue;
    if (full.dist.get(k) > maxExtendM) continue;
    const v = _vecM(S, adj.get(k).pt);
    const proj = v.x * dx + v.y * dy; // 外側方向への射影(m)
    if (proj < minProjM) continue;
    if (!best || proj > best.proj) best = { k, proj };
  }
  if (!best) return line;
  const ext = reconstruct(full.prev, sNear.key, best.k, adj); // sNear..best
  if (!ext) return line;

  const parts = [...ext.reverse()]; // best..sNear
  parts.push(...line); // S(≈sNear)..end
  return dedupNear(parts, 3);
}

export function routeOnGraph(a, b, ways, thresh_m = 35) {
  if (!a || !b || !Array.isArray(ways) || ways.length === 0) return null;
  const adj = getGraph(ways);
  if (adj.size === 0) return null;
  const na = nearestNode(adj, a);
  const nb = nearestNode(adj, b);
  if (!na.key || !nb.key) return null;
  if (na.dist > thresh_m || nb.dist > thresh_m) return null; // 道路から遠い→呼び出し側が直線
  const keys = dijkstra(adj, na.key, nb.key);
  if (!keys || keys.length < 1) return null;
  const mid = keys.map((k) => adj.get(k).pt);
  // 端点は実 a,b。間に道路網ノード列を挟む。
  return [a, ...mid, b];
}

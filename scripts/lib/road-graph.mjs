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

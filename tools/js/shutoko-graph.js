// Adjacency map built once from shutoko_graph.json
export function buildAdjacency(graph) {
  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to, []);
    adj.get(e.from).push({ to: e.to, km: e.km, route: e.route });
    adj.get(e.to).push({ to: e.from, km: e.km, route: e.route });   // undirected
  }
  return adj;
}

// banned: Set of "from|to" (無向なので両方向を入れること) — 通行禁止 edge
export function shortestPath(adj, fromId, toId, banned = null) {
  if (fromId === toId) return { km: 0, path: [fromId] };
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  dist.set(fromId, 0);

  // Simple priority queue (array scan — graph is small ~300 nodes so O(V^2) is fine)
  while (true) {
    let uId = null, uDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < uDist) { uId = id; uDist = d; }
    }
    if (uId === null) break;
    if (uId === toId) break;
    visited.add(uId);
    const neighbors = adj.get(uId) || [];
    for (const n of neighbors) {
      if (banned && banned.has(`${uId}|${n.to}`)) continue;
      const alt = uDist + n.km;
      if (alt < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, alt);
        prev.set(n.to, uId);
      }
    }
  }

  if (!dist.has(toId)) return { km: null, path: null };

  const path = [toId];
  let cur = toId;
  while (prev.has(cur)) {
    cur = prev.get(cur);
    path.unshift(cur);
  }
  return { km: dist.get(toId), path };
}

// k本の代替経路を返す (最短経路の各edgeを1本ずつ除外して再探索する簡易法)
// 戻り値: [{ km, path }] 距離昇順、 重複経路は除外
export function kShortestPaths(adj, fromId, toId, k = 3) {
  const first = shortestPath(adj, fromId, toId);
  if (!first.path) return [];
  const results = [first];
  const seen = new Set([first.path.join('>')]);
  const candidates = [];
  for (let i = 0; i < first.path.length - 1; i++) {
    const a = first.path[i], b = first.path[i + 1];
    const banned = new Set([`${a}|${b}`, `${b}|${a}`]);
    const alt = shortestPath(adj, fromId, toId, banned);
    if (alt.path) {
      const key = alt.path.join('>');
      if (!seen.has(key)) { seen.add(key); candidates.push(alt); }
    }
  }
  candidates.sort((x, y) => x.km - y.km);
  return [...results, ...candidates].slice(0, k);
}

// 全ノードへの最短距離 + prev (early-break しない Dijkstra)
export function dijkstraAll(adj, start) {
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const visited = new Set();
  while (true) {
    let u = null, ud = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < ud) { u = id; ud = d; }
    if (u === null) break;
    visited.add(u);
    for (const e of (adj.get(u) || [])) {
      const nd = ud + e.km;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  return { dist, prev };
}

export function reconstructTo(prev, from, to) {
  const path = [to];
  let cur = to;
  while (cur !== from) {
    if (!prev.has(cur)) return null;
    cur = prev.get(cur);
    path.unshift(cur);
  }
  return path;
}

// 指定 graph route のedgeを少なくとも1本通る最短経路 (from→viaNode→to の2段階)
export function shortestPathVia(adj, graph, from, to, viaRouteId) {
  const viaNodes = new Set();
  for (const e of graph.edges) {
    if (e.route === viaRouteId) { viaNodes.add(e.from); viaNodes.add(e.to); }
  }
  if (viaNodes.size === 0) return null;
  const fromD = dijkstraAll(adj, from);
  const toD = dijkstraAll(adj, to);
  let bestV = null, bestKm = Infinity;
  for (const v of viaNodes) {
    const d1 = fromD.dist.get(v), d2 = toD.dist.get(v);
    if (d1 == null || d2 == null) continue;
    if (d1 + d2 < bestKm) { bestKm = d1 + d2; bestV = v; }
  }
  if (!bestV) return null;
  const p1 = reconstructTo(fromD.prev, from, bestV);
  const p2 = reconstructTo(toD.prev, to, bestV);
  if (!p1 || !p2) return null;
  return { km: bestKm, path: [...p1, ...p2.slice().reverse().slice(1)] };
}

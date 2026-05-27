// scripts/lib/road-network.mjs — 道路網の純関数ヘルパー

const eq = (a, b, eps = 1e-7) => Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps;

function hav(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// 端点共有の ways を順に連結（双方向 OK）。複数の連結成分に分かれる場合は最長の成分を返す（後方互換）。
export function mergeWaysToPolyline(ways) {
  const components = mergeWaysAllComponents(ways);
  if (components.length === 0) return [];
  return components.reduce((a, b) => (b.length > a.length ? b : a));
}

// 全ての連結成分をリストで返す。進入方向を考慮した成分選択に使う。
export function mergeWaysAllComponents(ways) {
  if (!Array.isArray(ways) || ways.length === 0) return [];
  const segments = ways.map((w) => (w.geometry || []).map((p) => ({ lat: p.lat, lng: p.lng })))
    .filter((g) => g.length >= 2);
  if (segments.length === 0) return [];

  const remaining = segments.slice();
  const components = [];
  while (remaining.length > 0) {
    let chain = remaining.shift();
    let progressed = true;
    while (progressed && remaining.length > 0) {
      progressed = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const head = chain[0], tail = chain[chain.length - 1];
        const wHead = w[0], wTail = w[w.length - 1];
        if (eq(tail, wHead)) { chain = chain.concat(w.slice(1)); remaining.splice(i, 1); progressed = true; break; }
        if (eq(tail, wTail)) { chain = chain.concat(w.slice().reverse().slice(1)); remaining.splice(i, 1); progressed = true; break; }
        if (eq(head, wTail)) { chain = w.slice(0, -1).concat(chain); remaining.splice(i, 1); progressed = true; break; }
        if (eq(head, wHead)) { chain = w.slice().reverse().slice(0, -1).concat(chain); remaining.splice(i, 1); progressed = true; break; }
      }
    }
    components.push(chain);
  }
  return components;
}

export function nearestPointOnPolyline(polyline, pin) {
  if (!Array.isArray(polyline) || polyline.length === 0) return null;
  let best = { point: polyline[0], index: 0, dist: hav(polyline[0], pin) };
  for (let i = 1; i < polyline.length; i++) {
    const d = hav(polyline[i], pin);
    if (d < best.dist) best = { point: polyline[i], index: i, dist: d };
  }
  return { point: best.point, index: best.index, t: best.dist };
}

export function directionalEndpoint(polyline, pin, direction) {
  if (!Array.isArray(polyline) || polyline.length === 0) return null;
  const cmps = {
    east:  (a, b) => b.lng - a.lng,
    west:  (a, b) => a.lng - b.lng,
    north: (a, b) => b.lat - a.lat,
    south: (a, b) => a.lat - b.lat,
  };
  const cmp = cmps[direction] || cmps.east;
  let best = polyline[0];
  for (const p of polyline) if (cmp(best, p) > 0) best = p;
  return best;
}

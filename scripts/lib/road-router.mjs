// scripts/lib/road-router.mjs — 2点をOSM道路polylineに射影し、道路上で繋ぐ純関数
// 道路 polyline 群 (ways) を入力に、2点 (A, B) が「同じ道路上にある」と判定できれば
// 道路polyline 上の点列 [A射影, ..., B射影] を返す。
// 同じ道路上に乗らなければ null。呼び出し側はそれを「直線で繋ぐ」と解釈。
//
// 「同じ道路上にある」の判定: 同一way上で、Aの射影距離・Bの射影距離が両方 thresh 以下。

function hav(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function nearestVertex(polyline, p) {
  let best = { idx: 0, dist: Infinity };
  for (let i = 0; i < polyline.length; i++) {
    const d = hav(polyline[i], p);
    if (d < best.dist) best = { idx: i, dist: d };
  }
  return best;
}

function sliceBetween(polyline, i0, i1) {
  if (i0 === i1) return [polyline[i0]];
  if (i0 < i1) return polyline.slice(i0, i1 + 1);
  return polyline.slice(i1, i0 + 1).reverse();
}

// ways: [{ geometry: [{lat,lng},...], tags: {...} }]
// 戻り値: [{lat,lng}] 道路上の点列 / null（同じ道路に乗らなければ）
// thresh_m: 道路までの距離が thresh_m 以下なら「乗っている」と見なす（既定 30m）
export function routeOnRoadsBetween(a, b, ways, thresh_m = 30) {
  if (!a || !b || !Array.isArray(ways) || ways.length === 0) return null;
  let best = null;
  for (const w of ways) {
    if (!Array.isArray(w.geometry) || w.geometry.length < 2) continue;
    const aN = nearestVertex(w.geometry, a);
    const bN = nearestVertex(w.geometry, b);
    if (aN.dist > thresh_m || bN.dist > thresh_m) continue;
    const total = aN.dist + bN.dist;
    if (!best || total < best.total) {
      best = { way: w, aN, bN, total };
    }
  }
  if (!best) return null;
  const segment = sliceBetween(best.way.geometry, best.aN.idx, best.bN.idx);
  // 始点・終点を a,b 本人に置き換え（道路上の最寄り頂点ではなく実座標で結ぶ）
  if (segment.length >= 2) {
    return [a, ...segment.slice(1, -1), b];
  }
  return [a, b];
}

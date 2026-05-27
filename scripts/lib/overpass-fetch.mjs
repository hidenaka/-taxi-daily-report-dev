// scripts/lib/overpass-fetch.mjs — Overpass APIから道路ways取得（最小・依存ゼロ）

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// 指定中心から radius_m の範囲で、name 一致の highway way を取得。out geom で geometry 配列を含む。
// 戻り値: [{ id, geometry: [{lat,lng}...], tags }]
export async function fetchRoadWays(name, lat, lng, radius_m = 600) {
  const q = `
    [out:json][timeout:25];
    (
      way["highway"]["name"="${name}"](around:${radius_m},${lat},${lng});
    );
    out geom;
  `;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'taxi-stands-app/1.0',
    },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
  const data = await res.json();
  return (data.elements || [])
    .filter((e) => e.type === 'way' && Array.isArray(e.geometry))
    .map((e) => ({
      id: e.id,
      geometry: e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
      tags: e.tags || {},
    }));
}

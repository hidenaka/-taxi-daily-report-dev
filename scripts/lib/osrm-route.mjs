// scripts/lib/osrm-route.mjs — OSRM 公開APIで「実際に通れる・合法な」運転経路を取得。
// 一方通行/通行可否/分離帯は OSRM の car プロファイルが尊重する（自前Dijkstraの代替）。
// waypoints: [{lat,lng}] を順に通る driving 経路の geometry を [{lat,lng}] で返す。失敗時 null。
const DEFAULT_SERVER = 'https://router.project-osrm.org';

export async function routeViaOSRM(waypoints, { server = DEFAULT_SERVER } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${server}/route/v1/driving/${coords}`
    + '?overview=full&geometries=geojson&continue_straight=false';
  const res = await fetch(url, { headers: { 'User-Agent': 'taxi-stands/1.0' } });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) return null;
  const g = data.routes[0].geometry && data.routes[0].geometry.coordinates;
  if (!Array.isArray(g) || g.length < 2) return null;
  return g.map(([lng, lat]) => ({ lat, lng }));
}

// scripts/lib/nominatim-fetch.mjs — Nominatim(OSM公式 ジオコーディング)で
// ランドマーク名 → 緯度経度 を取得。検索半径を施設pin周辺に絞る。
// User-Agent 必須（Nominatim 利用規約）。

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const UA = 'taxi-stands-app/1.0';

// 施設pin周辺(viewbox)に絞って地名検索。最初のヒットを返す。
//   landmark: 検索語（建物名・交差点名・施設名）
//   pin: {lat,lng}
//   radius_m: viewbox の半径（既定 800m）
// 戻り値: {lat,lng} | null
export async function geocodeLandmark(landmark, pin, radius_m = 800) {
  if (!landmark) return null;
  const dlat = radius_m / 111320;
  const dlng = radius_m / (111320 * Math.cos(pin.lat * Math.PI / 180));
  const left = pin.lng - dlng, right = pin.lng + dlng;
  const top = pin.lat + dlat, bottom = pin.lat - dlat;
  const params = new URLSearchParams({
    q: landmark,
    format: 'json',
    limit: '1',
    viewbox: `${left},${top},${right},${bottom}`,
    bounded: '1',
    'accept-language': 'ja',
  });
  const url = `${ENDPOINT}?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
}

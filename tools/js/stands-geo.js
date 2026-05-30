// tools/js/stands-geo.js — ルート幾何ヘルパー（純関数）
import { haversineKm } from './util.js';

// a→b の方位角（0=北, 90=東, 時計回り, 0..360）
export function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 現在地から近い stand を n 件（pin 基準）
export function findNearestStands(pos, stands, n = 5) {
  if (!pos || !Array.isArray(stands)) return [];
  return stands
    .filter((s) => s && s.pin && typeof s.pin.lat === 'number' && typeof s.pin.lng === 'number')
    .map((s) => ({ stand: s, distKm: haversineKm(pos, s.pin) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, n);
}

// polyline 上に「向き矢印」を一定距離(既定 70m)ごとに間引いて置く。
// 全セグメントに置くと密集して見にくいため、距離間隔で配置して見やすくする。
export function arrowMarkersForRoute(points, stepM = 70) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const out = [];
  let acc = 0;
  let nextAt = Math.min(stepM * 0.5, 25); // 最初の矢印は少し進んだ位置に
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const segM = haversineKm(a, b) * 1000;
    if (segM <= 0) continue;
    const ang = bearingDeg(a, b);
    while (nextAt <= acc + segM) {
      const t = (nextAt - acc) / segM;
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), angleDeg: ang });
      nextAt += stepM;
    }
    acc += segM;
  }
  // 短すぎて1本も置けない時は中点に1つ
  if (!out.length) {
    const a = points[0], b = points[points.length - 1];
    out.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2, angleDeg: bearingDeg(a, b) });
  }
  return out;
}

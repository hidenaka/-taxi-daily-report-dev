// scripts/lib/sketch-to-line.mjs — semantics + ways → 進入線（純関数）
import {
  mergeWaysAllComponents, mergeWaysToPolyline, nearestPointOnPolyline, directionalEndpoint,
} from './road-network.mjs';

function sliceBetween(polyline, i0, i1) {
  if (i0 === i1) return [polyline[i0]];
  if (i0 < i1) return polyline.slice(i0, i1 + 1);
  return polyline.slice(i1, i0 + 1).reverse();
}

// 進入方向に合った連結成分を選ぶ。
// entry_direction=east → pin より東に点を持つ成分 (max_lng > pin.lng)
// entry_direction=west → pin より西に点を持つ成分 (min_lng < pin.lng)
// entry_direction=north → pin より北に点を持つ成分 (max_lat > pin.lat)
// entry_direction=south → pin より南に点を持つ成分 (min_lat < pin.lat)
// 条件を満たす成分が複数あれば最も pin に近い点を持つものを選ぶ。
// 条件を満たす成分がなければ最長成分にフォールバック。
function selectComponentForDirection(components, pin, direction) {
  if (components.length === 0) return [];
  if (components.length === 1) return components[0];

  const TOLERANCE = 0.0005; // ~50m、ちょうど pin 上の道路も拾えるよう少し余裕を持つ
  function satisfies(comp) {
    const lats = comp.map((p) => p.lat);
    const lngs = comp.map((p) => p.lng);
    const maxLat = Math.max(...lats), minLat = Math.min(...lats);
    const maxLng = Math.max(...lngs), minLng = Math.min(...lngs);
    switch (direction) {
      case 'east':  return maxLng > pin.lng - TOLERANCE;
      case 'west':  return minLng < pin.lng + TOLERANCE;
      case 'north': return maxLat > pin.lat - TOLERANCE;
      case 'south': return minLat < pin.lat + TOLERANCE;
      default:      return true;
    }
  }

  function hav(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }

  const candidates = components.filter(satisfies);
  if (candidates.length === 0) {
    // フォールバック: 最長
    return components.reduce((a, b) => (b.length > a.length ? b : a));
  }
  if (candidates.length === 1) return candidates[0];

  // 複数候補 → pin に最も近い点を持つものを選ぶ
  let best = candidates[0]; let bestDist = Infinity;
  for (const comp of candidates) {
    for (const p of comp) {
      const d = hav(p, pin);
      if (d < bestDist) { bestDist = d; best = comp; }
    }
  }
  return best;
}

// waypoints (ランドマーク名の配列、もしくは {lat,lng} 直接指定) を緯度経度に解決して
// 順に繋いだ折れ線を返す。geocoder は { resolve(name): {lat,lng}|null } を受け付ける。
// PDFの進入経路を実地図の建物・交差点を辿る形で再現する。
export async function buildApproachLineFromWaypoints({ waypoints, pin, geocoder }) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return [];
  const resolved = [];
  for (const w of waypoints) {
    if (w && typeof w === 'object' && typeof w.lat === 'number' && typeof w.lng === 'number') {
      resolved.push({ lat: w.lat, lng: w.lng, _name: w.label || null });
      continue;
    }
    const name = (typeof w === 'string') ? w : (w && w.landmark) || null;
    if (!name) continue;
    if (!geocoder || typeof geocoder.resolve !== 'function') continue;
    const r = await geocoder.resolve(name, pin);
    if (r && typeof r.lat === 'number' && typeof r.lng === 'number') {
      resolved.push({ lat: r.lat, lng: r.lng, _name: name });
    }
  }
  return resolved.length >= 2 ? resolved.map((p) => ({ lat: p.lat, lng: p.lng })) : [];
}

export function buildApproachLine({ semantics, mainWays, turnWays, pin }) {
  if (!Array.isArray(mainWays) || mainWays.length === 0) return [];
  const mainComponents = mergeWaysAllComponents(mainWays);
  const main = selectComponentForDirection(mainComponents, pin, semantics.entry_direction || 'east');
  if (main.length < 2) return [];

  const startPoint = directionalEndpoint(main, pin, semantics.entry_direction || 'east');
  if (!startPoint) return [];
  const startIdx = main.findIndex((p) => p.lat === startPoint.lat && p.lng === startPoint.lng);
  const nearestOnMain = nearestPointOnPolyline(main, pin);
  if (!nearestOnMain) return [];

  if (!semantics.turn || !Array.isArray(turnWays) || turnWays.length === 0) {
    return sliceBetween(main, startIdx, nearestOnMain.index);
  }

  const turnComponents = mergeWaysAllComponents(turnWays);
  const turn = selectComponentForDirection(turnComponents, pin, semantics.turn === 'left' ? 'north' : 'south');
  if (turn.length < 2) return sliceBetween(main, startIdx, nearestOnMain.index);

  let bestMainIdx = 0, bestTurnIdx = 0, bestD = Infinity;
  for (let i = 0; i < main.length; i++) {
    const r = nearestPointOnPolyline(turn, main[i]);
    if (r && r.t < bestD) { bestD = r.t; bestMainIdx = i; bestTurnIdx = r.index; }
  }

  const nearestOnTurn = nearestPointOnPolyline(turn, pin);

  const seg1 = sliceBetween(main, startIdx, bestMainIdx);
  const seg2 = sliceBetween(turn, bestTurnIdx, nearestOnTurn.index);
  const last1 = seg1[seg1.length - 1];
  const first2 = seg2[0];
  if (last1 && first2 && Math.abs(last1.lat - first2.lat) < 1e-6 && Math.abs(last1.lng - first2.lng) < 1e-6) {
    return seg1.concat(seg2.slice(1));
  }
  return seg1.concat(seg2);
}

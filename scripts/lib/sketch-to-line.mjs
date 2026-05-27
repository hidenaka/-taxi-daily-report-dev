// scripts/lib/sketch-to-line.mjs — semantics + ways → 進入線（純関数）
import {
  mergeWaysToPolyline, nearestPointOnPolyline, directionalEndpoint,
} from './road-network.mjs';

function sliceBetween(polyline, i0, i1) {
  if (i0 === i1) return [polyline[i0]];
  if (i0 < i1) return polyline.slice(i0, i1 + 1);
  return polyline.slice(i1, i0 + 1).reverse();
}

export function buildApproachLine({ semantics, mainWays, turnWays, pin }) {
  if (!Array.isArray(mainWays) || mainWays.length === 0) return [];
  const main = mergeWaysToPolyline(mainWays);
  if (main.length < 2) return [];

  const startPoint = directionalEndpoint(main, pin, semantics.entry_direction || 'east');
  if (!startPoint) return [];
  const startIdx = main.findIndex((p) => p.lat === startPoint.lat && p.lng === startPoint.lng);
  const nearestOnMain = nearestPointOnPolyline(main, pin);
  if (!nearestOnMain) return [];

  if (!semantics.turn || !Array.isArray(turnWays) || turnWays.length === 0) {
    return sliceBetween(main, startIdx, nearestOnMain.index);
  }

  const turn = mergeWaysToPolyline(turnWays);
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

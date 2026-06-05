import { dowOf } from '../chart-helpers.js';
import { normalizePlace } from './place.js';

export function goalKeyFor(dateStr) {
  return 'cabis_coach_daily_goal_' + dateStr;
}

export function interpretDailyGoal(raw) {
  let o;
  try {
    o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'money' && Number(o.targetYen) > 0) {
    return { type: 'money', targetYen: Number(o.targetYen) };
  }
  if (o.type === 'time' && Number(o.targetReturnMin) >= 0) {
    const g = { type: 'time', targetReturnMin: Number(o.targetReturnMin) };
    if (o.targetYen != null && Number(o.targetYen) > 0) g.targetYen = Number(o.targetYen);
    return g;
  }
  return null;
}

export function buildContext(dateStr, nowMin, gpsPlace, vehicleType) {
  const min = Number(nowMin) || 0;
  return {
    area: normalizePlace(gpsPlace || ''),
    dow: dowOf(dateStr),
    hour: Math.floor(min / 60),
    nowMin: min,
    vehicleType: vehicleType || 'japantaxi',
  };
}

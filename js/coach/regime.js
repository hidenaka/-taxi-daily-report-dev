import { dowOf } from '../chart-helpers.js';

function hourOf(timeStr) {
  const h = parseInt(String(timeStr || '').split(':')[0], 10);
  return Number.isFinite(h) ? h : null;
}

// dow×hour の1日平均乗車数（非キャンセル）。一致日なしは null。
export function expectedRideDensity(drives, dow, hour) {
  const days = (drives || []).filter((d) => d && d.date && dowOf(d.date) === dow);
  if (days.length === 0) return null;
  let total = 0;
  for (const d of days) {
    for (const tr of (d.trips || [])) {
      if (tr.isCancel) continue;
      if (hourOf(tr.boardTime) === hour) total += 1;
    }
  }
  return total / days.length;
}

// 期待乗車数 → レジーム。density null は unknown。
export function classifyRegime(density, opts = {}) {
  const { threshold = 1.5 } = opts;
  if (density == null) return 'unknown';
  return density >= threshold ? 'volume' : 'value';
}

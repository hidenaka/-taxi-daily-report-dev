// 現在地・時刻・目標・履歴から構造化「事実パック」を生成する純関数。
// 数字はここで全部確定し、後段のLLMは語るだけ。

import {
  hourlyDowEfficiency,
  nextBoardBreakdown,
  highValueAreas,
} from '../chart-helpers.js';
import { computeGoalProgress } from './daily-goal.js';

/**
 * drives 内の非キャンセル trip の売上平均を返す。
 * trip が 1 件もない場合は null。
 *
 * ※ chart-helpers.avgTripSales とは意図的に実装を分けている。
 * avgTripSales は summary-only drive をスキップするが amount=0 のキャンセルを加算してしまう。
 * こちらは neededTrips（目標到達に必要な本数）の算出用に「成立した運賃のみ」を平均したいため、
 * isCancel / amount<=0 を除外している。
 */
export function avgTripYen(drives) {
  let sum = 0, n = 0;
  for (const d of (drives || [])) {
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      const a = Number(t.amount);
      if (Number.isFinite(a) && a > 0) { sum += a; n += 1; }
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * 事実パックを生成して返す。
 *
 * @param {object} input
 * @param {Array}  input.drives      - 過去乗務データ
 * @param {object} input.ctx         - { area, dow, hour, nowMin, vehicleType }
 * @param {object|null} input.goal   - { type, targetYen? } | null
 * @param {number} input.todaySales  - 当日累計売上
 * @returns {FactPack}
 */
export function buildFactPack(input) {
  const { drives = [], ctx, goal = null, todaySales = 0 } = input;
  const { area, dow, hour, nowMin, vehicleType } = ctx;

  // --- you: 現在時刻・曜日の時給効率 ---
  const eff = hourlyDowEfficiency(drives);
  const cell = (eff[dow] && eff[dow][hour]) ? eff[dow][hour] : null;
  const hourlyA = (cell && cell.days > 0 && Number.isFinite(cell.hourlyA)) ? Math.round(cell.hourlyA) : null;

  // --- nextMoves: 現在エリアで降車後の次乗車先 上位3件 ---
  const nb = nextBoardBreakdown(drives, area, hour, 1, null);
  const nextMoves = (nb.rows || [])
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((r) => ({ area: r.area, count: Number(r.count) || 0 }));

  // --- highValue: 高期待値エリア上位3件 ---
  const hv = highValueAreas(drives, { minSamples: 1 }).slice(0, 3).map((h) => ({
    area: h.area,
    period: h.period,
    avgSales: Math.round(h.avgSales),
  }));

  // --- goal: 目標逆算 ---
  const goalProgress = goal
    ? computeGoalProgress(goal, { todaySales, nowMin, avgTripYen: avgTripYen(drives) })
    : null;

  return {
    now: { area, dow, hour, vehicleType },
    you: { hourlyA },
    nextMoves,
    highValue: hv,
    goal: goalProgress,
  };
}

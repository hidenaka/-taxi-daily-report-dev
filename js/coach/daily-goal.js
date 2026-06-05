// 今日の目標と当日進捗から、相談で語る逆算事実を計算する純関数。
// nowMin / targetReturnMin は0時からの経過分（例 19:00 = 1140）。

export function computeGoalProgress(goal, snapshot) {
  const todaySales = Number(snapshot?.todaySales) || 0;
  const nowMin = Number(snapshot?.nowMin) || 0;
  const avgTripYen = Number(snapshot?.avgTripYen);

  const type = goal?.type === 'time' ? 'time' : 'money';

  const targetYen = (goal && goal.targetYen != null) ? Number(goal.targetYen) : null;
  const remainingYen = targetYen != null ? Math.max(0, targetYen - todaySales) : null;

  const remainingMin = (type === 'time' && goal.targetReturnMin != null)
    ? Math.max(0, Number(goal.targetReturnMin) - nowMin)
    : null;

  const neededTrips = (remainingYen != null && Number.isFinite(avgTripYen) && avgTripYen > 0)
    ? Math.ceil(remainingYen / avgTripYen)
    : null;

  const reached = type === 'time' ? (remainingMin === 0) : (remainingYen === 0);

  return { type, remainingYen, remainingMin, neededTrips, reached };
}

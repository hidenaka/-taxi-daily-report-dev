// FactPack(Plan 1) + intent → 構造化回答プラン。数字は全てFactPack由来。LLM不使用。
//
// AnswerPlan フィールドと basis タグの対応:
//   goal-remaining ↔ facts.remainingYen / neededTrips / remainingMin
//   next-board     ↔ moves
//   your-hourly    ↔ facts.hourlyA
//   high-value     ↔ spots

export const INTENTS = ['reach-goal', 'assess-here', 'finish-early'];

export function composeAnswer(factPack, intent) {
  if (!INTENTS.includes(intent)) {
    throw new Error('unknown intent: ' + intent);
  }
  const goal = factPack.goal || null;
  const you = factPack.you || {};
  const nextMoves = Array.isArray(factPack.nextMoves) ? factPack.nextMoves : [];
  const highValue = Array.isArray(factPack.highValue) ? factPack.highValue : [];

  const status = goal == null ? 'unknown' : (goal.reached ? 'reached' : 'in-progress');

  const facts = {
    remainingYen: goal ? goal.remainingYen : null,
    neededTrips: goal ? goal.neededTrips : null,
    remainingMin: goal ? goal.remainingMin : null,
    hourlyA: (you.hourlyA != null) ? you.hourlyA : null,
  };

  const moves = nextMoves.slice(0, 3).map((m) => ({ area: m.area, count: Number(m.count) || 0 }));

  // high-value エリア上位3件を後段(formatter/UI)が根拠表示に使えるよう spots として渡す
  const spots = highValue.slice(0, 3).map((h) => ({ area: h.area, period: h.period, avgSales: h.avgSales }));

  const basis = [];
  if (goal) basis.push('goal-remaining');
  if (moves.length) basis.push('next-board');
  if (facts.hourlyA != null) basis.push('your-hourly');
  if (highValue.length) basis.push('high-value');

  const regime = factPack.regime || { kind: 'unknown', density: null };
  return { intent, status, facts, moves, basis, spots, regime };
}

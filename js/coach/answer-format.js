// AnswerPlan → 日本語の表示行。最小版（Plan 3 UIで差し替え・拡張しうる）。

function yen(n) { return Math.round(Number(n)).toLocaleString('ja-JP'); }

export function formatAnswer(plan) {
  if (!plan) return ['今わかる範囲でお答えします'];
  const lines = [];
  const f = plan.facts || {};

  if (plan.status === 'reached') {
    lines.push('🎉 目標達成。お疲れさま。');
  } else if (plan.intent === 'finish-early' && f.remainingMin != null) {
    let head = `あと約${f.remainingMin}分で目標時刻`;
    if (f.remainingYen != null) head += `／残り¥${yen(f.remainingYen)}`;
    lines.push(head);
  } else if (plan.intent === 'reach-goal' && f.remainingYen != null) {
    lines.push(f.neededTrips != null
      ? `目標まで あと¥${yen(f.remainingYen)}（約${f.neededTrips}本ペース）`
      : `目標まで あと¥${yen(f.remainingYen)}`);
  } else if (plan.intent === 'assess-here') {
    lines.push('今の見立て');
  } else {
    lines.push('今わかる範囲でお答えします');
  }

  if (Array.isArray(plan.moves) && plan.moves.length) {
    lines.push(`次の一手：${plan.moves.map((m) => m.area).join(' → ')}`);
  }

  if (Array.isArray(plan.spots) && plan.spots.length) {
    lines.push(`高期待値：${plan.spots.map((s) => `${s.area}(${s.period}) ¥${yen(s.avgSales)}`).join('、')}`);
  }

  if (f.hourlyA != null) {
    lines.push(`根拠：この時間のあなたの時給 ¥${yen(f.hourlyA)}/時`);
  }

  return lines;
}

import { buildFactPack } from './fact-engine.js';
import { composeAnswer } from './answer-composer.js';
import { formatAnswer } from './answer-format.js';

// UIから呼ぶ唯一のロジック入口。事実パック生成→回答合成→整形を1本に。
export function runCoach({ drives = [], todaySales = 0, ctx, goal = null, intent }) {
  const factPack = buildFactPack({ drives, ctx, goal, todaySales });
  const plan = composeAnswer(factPack, intent);
  return { plan, lines: formatAnswer(plan) };
}

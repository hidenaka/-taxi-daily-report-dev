import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runCoach } from '../js/coach/coach-run.js';

const drives = [
  { date: '2026-05-01', departureTime: '07:00', returnTime: '22:00',
    trips: [
      { amount: 2000, boardTime: '19:10', alightTime: '19:25', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isCancel: false },
      { amount: 2600, boardTime: '19:40', alightTime: '19:55', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isCancel: false },
    ] },
];

describe('runCoach', () => {
  const ctx = { area: '港区六本木', dow: 5, hour: 19, nowMin: 1170, vehicleType: 'premium' };

  it('plan と lines(非空配列) を返す', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const r = runCoach({ drives, todaySales: 21400, ctx, goal, intent: 'reach-goal' });
    assert.strictEqual(r.plan.intent, 'reach-goal');
    assert.ok(Array.isArray(r.lines));
    assert.ok(r.lines.length >= 1);
    assert.ok(r.lines.join('\n').includes('8,600'));
  });

  it('goal無しでも動く（status unknown）', () => {
    const r = runCoach({ drives, todaySales: 0, ctx, goal: null, intent: 'assess-here' });
    assert.strictEqual(r.plan.status, 'unknown');
    assert.ok(r.lines.length >= 1);
  });
});

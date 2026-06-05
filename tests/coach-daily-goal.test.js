import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeGoalProgress } from '../js/coach/daily-goal.js';

describe('computeGoalProgress', () => {
  it('額目標: 残額と必要本数を切り上げで返す', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const snap = { todaySales: 21400, nowMin: 1307, avgTripYen: 2300 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.type, 'money');
    assert.strictEqual(r.remainingYen, 8600);
    assert.strictEqual(r.neededTrips, 4);
    assert.strictEqual(r.remainingMin, null);
    assert.strictEqual(r.reached, false);
  });

  it('額目標: 到達済みは remainingYen=0 / neededTrips=0 / reached=true', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const snap = { todaySales: 31000, nowMin: 1200, avgTripYen: 2300 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.remainingYen, 0);
    assert.strictEqual(r.neededTrips, 0);
    assert.strictEqual(r.reached, true);
  });

  it('時刻目標: 残時間を返す。額目標が無ければ remainingYen/neededTrips は null', () => {
    const goal = { type: 'time', targetReturnMin: 1140 };
    const snap = { todaySales: 18000, nowMin: 1080, avgTripYen: 2300 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.type, 'time');
    assert.strictEqual(r.remainingMin, 60);
    assert.strictEqual(r.remainingYen, null);
    assert.strictEqual(r.neededTrips, null);
    assert.strictEqual(r.reached, false);
  });

  it('時刻目標＋額目標併記: 残時間と残額の両方を返す', () => {
    const goal = { type: 'time', targetReturnMin: 1140, targetYen: 30000 };
    const snap = { todaySales: 26000, nowMin: 1100, avgTripYen: 2000 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.remainingMin, 40);
    assert.strictEqual(r.remainingYen, 4000);
    assert.strictEqual(r.neededTrips, 2);
  });

  it('avgTripYen が null/0 のとき neededTrips は null（ゼロ割を防ぐ）', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const r = computeGoalProgress(goal, { todaySales: 10000, nowMin: 1000, avgTripYen: null });
    assert.strictEqual(r.neededTrips, null);
    assert.strictEqual(r.remainingYen, 20000);
  });
});

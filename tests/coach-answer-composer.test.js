import { describe, it } from 'node:test';
import assert from 'node:assert';
import { composeAnswer, INTENTS } from '../js/coach/answer-composer.js';

const baseFactPack = {
  now: { area: '港区六本木', dow: 5, hour: 19, vehicleType: 'premium' },
  you: { hourlyA: 3900 },
  nextMoves: [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ],
  highValue: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
  goal: { type: 'money', remainingYen: 8600, remainingMin: null, neededTrips: 4, reached: false },
};

describe('composeAnswer', () => {
  it('INTENTS は3意図', () => {
    assert.deepStrictEqual(INTENTS, ['reach-goal', 'assess-here', 'finish-early']);
  });
  it('reach-goal: 目標未達は in-progress、facts と moves と basis を埋める', () => {
    const a = composeAnswer(baseFactPack, 'reach-goal');
    assert.strictEqual(a.intent, 'reach-goal');
    assert.strictEqual(a.status, 'in-progress');
    assert.strictEqual(a.facts.remainingYen, 8600);
    assert.strictEqual(a.facts.neededTrips, 4);
    assert.strictEqual(a.facts.hourlyA, 3900);
    assert.deepStrictEqual(a.moves, [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ]);
    assert.deepStrictEqual(a.basis, ['goal-remaining', 'next-board', 'your-hourly', 'high-value']);
  });
  it('goal到達済みは status=reached', () => {
    const fp = { ...baseFactPack, goal: { ...baseFactPack.goal, remainingYen: 0, neededTrips: 0, reached: true } };
    const a = composeAnswer(fp, 'reach-goal');
    assert.strictEqual(a.status, 'reached');
    assert.strictEqual(a.facts.remainingYen, 0);
  });
  it('goalがnullなら status=unknown・remaining系はnull・basisにgoal-remaining無し', () => {
    const fp = { ...baseFactPack, goal: null };
    const a = composeAnswer(fp, 'assess-here');
    assert.strictEqual(a.status, 'unknown');
    assert.strictEqual(a.facts.remainingYen, null);
    assert.strictEqual(a.facts.neededTrips, null);
    assert.strictEqual(a.facts.remainingMin, null);
    assert.ok(!a.basis.includes('goal-remaining'));
    assert.ok(a.basis.includes('your-hourly'));
  });
  it('nextMoves空なら moves空・basisにnext-board無し', () => {
    const fp = { ...baseFactPack, nextMoves: [] };
    const a = composeAnswer(fp, 'reach-goal');
    assert.deepStrictEqual(a.moves, []);
    assert.ok(!a.basis.includes('next-board'));
  });
  it('hourlyAがnullなら basisにyour-hourly無し', () => {
    const fp = { ...baseFactPack, you: { hourlyA: null } };
    const a = composeAnswer(fp, 'assess-here');
    assert.strictEqual(a.facts.hourlyA, null);
    assert.ok(!a.basis.includes('your-hourly'));
  });
  it('finish-early: 時刻目標の残時間を facts.remainingMin に写す', () => {
    const fp = { ...baseFactPack, goal: { type: 'time', remainingYen: null, remainingMin: 40, neededTrips: null, reached: false } };
    const a = composeAnswer(fp, 'finish-early');
    assert.strictEqual(a.intent, 'finish-early');
    assert.strictEqual(a.facts.remainingMin, 40);
    assert.strictEqual(a.status, 'in-progress');
  });
  it('未知の intent は throw', () => {
    assert.throws(() => composeAnswer(baseFactPack, 'bogus'), /unknown intent/);
  });
});

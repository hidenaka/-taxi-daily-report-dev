import { describe, it } from 'node:test';
import assert from 'node:assert';
import { interpretDailyGoal, goalKeyFor, buildContext } from '../js/coach/coach-context.js';

describe('goalKeyFor', () => {
  it('日付ごとにキーを分ける', () => {
    assert.strictEqual(goalKeyFor('2026-06-05'), 'cabis_coach_daily_goal_2026-06-05');
  });
});

describe('interpretDailyGoal', () => {
  it('money目標(JSON文字列)を解釈', () => {
    assert.deepStrictEqual(interpretDailyGoal('{"type":"money","targetYen":30000}'), { type: 'money', targetYen: 30000 });
  });
  it('time目標を解釈（targetYen併記あり）', () => {
    assert.deepStrictEqual(
      interpretDailyGoal({ type: 'time', targetReturnMin: 1140, targetYen: 30000 }),
      { type: 'time', targetReturnMin: 1140, targetYen: 30000 });
  });
  it('time目標（額併記なし）', () => {
    assert.deepStrictEqual(interpretDailyGoal({ type: 'time', targetReturnMin: 1140 }), { type: 'time', targetReturnMin: 1140 });
  });
  it('不正値は null', () => {
    assert.strictEqual(interpretDailyGoal(null), null);
    assert.strictEqual(interpretDailyGoal('not json'), null);
    assert.strictEqual(interpretDailyGoal('{"type":"money","targetYen":0}'), null);
    assert.strictEqual(interpretDailyGoal('{"type":"bogus"}'), null);
  });
});

describe('buildContext', () => {
  it('現在地・時刻・曜日からctxを組み立てる（areaは正規化）', () => {
    const ctx = buildContext('2026-06-05', 1170, '港区六本木6', 'premium');
    assert.strictEqual(ctx.area, '港区六本木');
    assert.strictEqual(ctx.dow, 5);
    assert.strictEqual(ctx.hour, 19);
    assert.strictEqual(ctx.nowMin, 1170);
    assert.strictEqual(ctx.vehicleType, 'premium');
  });
  it('vehicleType未指定は japantaxi', () => {
    assert.strictEqual(buildContext('2026-06-05', 600, '港区六本木', null).vehicleType, 'japantaxi');
  });
});

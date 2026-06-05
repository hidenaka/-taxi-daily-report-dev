import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatAnswer } from '../js/coach/answer-format.js';

function joined(plan) { return formatAnswer(plan).join('\n'); }

describe('formatAnswer', () => {
  it('reach-goal in-progress: 残額・本数・次の一手・高期待値・根拠を含む', () => {
    const plan = {
      intent: 'reach-goal', status: 'in-progress',
      facts: { remainingYen: 8600, neededTrips: 4, remainingMin: null, hourlyA: 3900 },
      moves: [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ],
      spots: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
      basis: ['goal-remaining', 'next-board', 'your-hourly', 'high-value'],
    };
    const t = joined(plan);
    assert.ok(t.includes('8,600'));
    assert.ok(t.includes('4本'));
    assert.ok(t.includes('港区西麻布'));
    assert.ok(t.includes('渋谷区恵比寿'));
    assert.ok(t.includes('高期待値'));
    assert.ok(t.includes('港区六本木'));
    assert.ok(t.includes('2,600'));
    assert.ok(t.includes('3,900'));
    assert.ok(formatAnswer(plan).length >= 1);
  });

  it('reached: 達成メッセージを見出しに出す', () => {
    const plan = { intent: 'reach-goal', status: 'reached',
      facts: { remainingYen: 0, neededTrips: 0, remainingMin: null, hourlyA: 3900 }, moves: [], spots: [], basis: [] };
    assert.ok(joined(plan).includes('達成'));
  });

  it('finish-early: 残時間と残額を含む', () => {
    const plan = { intent: 'finish-early', status: 'in-progress',
      facts: { remainingYen: 4000, neededTrips: 2, remainingMin: 40, hourlyA: null }, moves: [], spots: [], basis: [] };
    const t = joined(plan);
    assert.ok(t.includes('40分'));
    assert.ok(t.includes('4,000'));
  });

  it('assess-here: 次の一手と根拠を含む', () => {
    const plan = { intent: 'assess-here', status: 'unknown',
      facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: 3900 },
      moves: [ { area: '港区西麻布', count: 3 } ], spots: [], basis: ['next-board', 'your-hourly'] };
    const t = joined(plan);
    assert.ok(t.includes('港区西麻布'));
    assert.ok(t.includes('3,900'));
  });

  it('facts不足でも最低1行は返す', () => {
    const plan = { intent: 'reach-goal', status: 'unknown',
      facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: null }, moves: [], spots: [], basis: [] };
    assert.ok(formatAnswer(plan).length >= 1);
  });

  it('neededTripsがnullなら本数表記を出さない', () => {
    const plan = { intent: 'reach-goal', status: 'in-progress',
      facts: { remainingYen: 5000, neededTrips: null, remainingMin: null, hourlyA: null }, moves: [], spots: [], basis: [] };
    const t = joined(plan);
    assert.ok(t.includes('5,000'));
    assert.ok(!t.includes('本ペース'));
  });
});

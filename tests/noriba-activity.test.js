import { test, assert } from './run.js';
import { classifyNormalRatio, findActiveUntil, buildNoribaActivity } from '../tools/js/arrivals-data.js';

test('classifyNormalRatio: 多い/並み/静か/基準ゼロ/欠損', () => {
  assert.equal(classifyNormalRatio(5, 2.5).dir, 'up');
  assert.equal(classifyNormalRatio(2, 2).dir, 'eq');
  assert.equal(classifyNormalRatio(1, 3).dir, 'down');
  assert.equal(classifyNormalRatio(5, 0.1).dir, null);   // 基準≈0は非表示
  assert.equal(classifyNormalRatio(null, 2).dir, null);
});

test('findActiveUntil: ピーク半分を下回る時刻 / soon / long', () => {
  const peak = 4;
  const fwd = [{min:1320,val:4},{min:1335,val:4},{min:1350,val:4},{min:1365,val:1}];
  assert.equal(findActiveUntil(fwd, peak), '22:45');
  assert.equal(findActiveUntil([{min:1320,val:1},{min:1335,val:1}], peak), 'soon');
  assert.equal(findActiveUntil([{min:1320,val:4},{min:1335,val:4}], peak), 'long');
  assert.equal(findActiveUntil([], peak), null);
});

function fc() {
  const slots = [];
  for (let i = 0; i < 96; i++) {
    const v3 = (i >= 84 && i <= 94) ? (i <= 90 ? 5 : 2) : 0.2; // 21:00..23:30 高、以降低
    slots.push({ time: `${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`, stalls: { stall1: 1, stall2: 0.5, stall3: v3, stall4: 1 } });
  }
  return { slots, actualsToday: [{ time: '22:00', stalls: { stall1:1, stall2:0.5, stall3:9, stall4:1 } }], current: { time:'22:00', stalls: { stall1:1, stall2:0.5, stall3:9, stall4:1 } } };
}
function arr() {
  return { flights: [
    { poolLane:1, status:'到着予定', scheduledTime:'22:30', estimatedTime:'22:30', fromName:'福岡', seatCount:335, estimatedTaxiPax:90 },
    { poolLane:3, status:'到着予定', scheduledTime:'22:20', estimatedTime:'22:20', fromName:'那覇', seatCount:335, estimatedTaxiPax:160 },
    { poolLane:3, status:'欠航',     scheduledTime:'22:40', estimatedTime:'22:40', fromName:'新千歳', seatCount:165 },
  ] };
}
const NOW = new Date('2026-06-19T22:00:00+09:00');

test('buildNoribaActivity: 号→T1/T2 と 需要集計', () => {
  const a = buildNoribaActivity(arr(), fc(), NOW);
  assert.equal(a.length, 4);
  assert.equal(a[0].lane, 1); assert.equal(a[0].terminal, 'T1');
  assert.equal(a[2].lane, 3); assert.equal(a[2].terminal, 'T2');
  assert.equal(a[0].demand.flights60, 1);
  assert.equal(a[2].demand.flights60, 1);
  assert.equal(a[2].demand.pax60, 160);
});

test('buildNoribaActivity: 3号は通常比up＋活発untilが時刻', () => {
  const a = buildNoribaActivity(arr(), fc(), NOW)[2];
  assert.equal(a.movement.ratioDir, 'up');
  assert.ok(typeof a.movement.activeUntil === 'string');
  assert.equal(a.movement.level, '強');
});

test('buildNoribaActivity: forecast欠落時は動き非表示で安全劣化', () => {
  const a = buildNoribaActivity(arr(), null, NOW)[0];
  assert.equal(a.movement.level, null);
  assert.equal(a.movement.normalRatio, null);
  assert.equal(a.demand.flights60, 1);
});

test('buildNoribaActivity: 動きが弱い号は activeUntil を出さない(閑散時の誤解防止)', () => {
  const slots = [];
  for (let i = 0; i < 96; i++) {
    const v = (i >= 88 && i <= 90) ? 10 : 1; // 夜にピーク10、昼は低い
    slots.push({ time: `${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`, stalls: { stall1: v, stall2: 1, stall3: 1, stall4: 1 } });
  }
  const f = { slots, actualsToday: [], current: { time: '14:00', stalls: { stall1: 1, stall2: 1, stall3: 1, stall4: 1 } } };
  const a = buildNoribaActivity({ flights: [] }, f, new Date('2026-06-19T14:00:00+09:00'))[0];
  assert.equal(a.movement.level, '弱');     // 現在1 / ピーク10
  assert.equal(a.movement.activeUntil, null); // 弱いので活発untilは出さない
});

import { test, assert } from './run.js';
import { classifyNormalRatio, findActiveUntil, buildNoribaActivity, occupancySegments, occupancyLabel, fillRateSegments } from '../tools/js/arrivals-data.js';

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
  const a = buildNoribaActivity(arr(), fc(), null, NOW);
  assert.equal(a.length, 4);
  assert.equal(a[0].lane, 1); assert.equal(a[0].terminal, 'T1');
  assert.equal(a[2].lane, 3); assert.equal(a[2].terminal, 'T2');
  assert.equal(a[0].demand.flights60, 1);
  assert.equal(a[2].demand.flights60, 1);
  assert.equal(a[2].demand.pax60, 160);
});

test('buildNoribaActivity: 3号は通常比up＋活発untilが時刻', () => {
  const a = buildNoribaActivity(arr(), fc(), null, NOW)[2];
  assert.equal(a.movement.ratioDir, 'up');
  assert.ok(typeof a.movement.activeUntil === 'string');
  assert.equal(a.movement.level, '強');
});

test('buildNoribaActivity: forecast欠落時は動き非表示で安全劣化', () => {
  const a = buildNoribaActivity(arr(), null, null, NOW)[0];
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
  const a = buildNoribaActivity({ flights: [] }, f, null, new Date('2026-06-19T14:00:00+09:00'))[0];
  assert.equal(a.movement.level, '弱');     // 現在1 / ピーク10
  assert.equal(a.movement.activeUntil, null); // 弱いので活発untilは出さない
});

test('occupancySegments: 占有→0..5段(容量比)', () => {
  assert.equal(occupancySegments(0, 8), 0);
  assert.equal(occupancySegments(4, 8), 3);   // round(4/8*5)=round(2.5)=3
  assert.equal(occupancySegments(8, 8), 5);
  assert.equal(occupancySegments(20, 8), 5);  // clamp
  assert.equal(occupancySegments(4, 0), 0);   // 容量0は0
});

test('occupancyLabel: 段数→言葉', () => {
  assert.equal(occupancyLabel(1), '少なめ');
  assert.equal(occupancyLabel(3), '並程度');
  assert.equal(occupancyLabel(5), '多め');
  assert.equal(occupancyLabel(null), null);
});

test('buildNoribaActivity: pool-statusから待機車両を結合', () => {
  const ps = { stalls: { stall3: { occ: 4 } } };
  const a = buildNoribaActivity(arr(), fc(), ps, NOW)[2]; // 3号
  assert.equal(a.occupancy.vehicles, 4);
  assert.equal(a.occupancy.segments >= 1, true);
  assert.equal(typeof a.occupancy.label, 'string');
});

test('buildNoribaActivity: pool-status欠落時は待機車両null(安全劣化)', () => {
  const a = buildNoribaActivity(arr(), fc(), null, NOW)[0];
  assert.equal(a.occupancy.vehicles, null);
  assert.equal(a.occupancy.segments, 0);
  assert.equal(a.occupancy.label, null);
});

test('buildNoribaActivity: 流れの通常目盛り位置(基準ありで数値)', () => {
  const a = buildNoribaActivity(arr(), fc(), null, NOW)[2]; // 3号 基準あり
  assert.equal(typeof a.movement.fillPct, 'number');
  assert.equal(typeof a.movement.normalMarkerPct, 'number');
});

test('fillRateSegments: 全レーン埋まり率→0..5段', () => {
  assert.equal(fillRateSegments(0), 0);
  assert.equal(fillRateSegments(0.5), 3);  // round(2.5)=3
  assert.equal(fillRateSegments(0.9), 5);  // round(4.5)=5 → 満車=多め
  assert.equal(fillRateSegments(1), 5);
  assert.equal(fillRateSegments(1.5), 5);  // clamp
  assert.equal(fillRateSegments(null), 0);
});

test('buildNoribaActivity: fillRateがあれば全レーン埋まり率を主系に(満車→多め)', () => {
  // 前列occは並(4/16)でも、全レーンfillRate=0.95(満車)なら 多め=seg5
  const ps = { stalls: { stall3: { occ: 4, fillRate: 0.95 } } };
  const a = buildNoribaActivity(arr(), fc(), ps, NOW)[2];
  assert.equal(a.occupancy.segments, 5);
  assert.equal(a.occupancy.label, '多め');
  assert.equal(a.occupancy.fillPct, 95);
  assert.equal(a.occupancy.vehicles, 4);   // occ も保持
});

test('buildNoribaActivity: fillRate無いデータは従来occにフォールバック', () => {
  const ps = { stalls: { stall3: { occ: 16 } } }; // fillRate無し→occ/容量16=満
  const a = buildNoribaActivity(arr(), fc(), ps, NOW)[2];
  assert.equal(a.occupancy.segments, 5);
  assert.equal(a.occupancy.fillPct, undefined); // fillPctは付かない
});

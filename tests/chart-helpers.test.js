import { test } from 'node:test';
import assert from 'node:assert';
import { hourlyDowEfficiency } from '../js/chart-helpers.js';

test('hourlyDowEfficiency: 休憩中の時間は実稼働時間 (workingMin) から除外される', () => {
  // 木曜 (2026-04-23 は木曜)
  // 出庫 18:00、帰庫 20:00、休憩 18:00-19:30 → 18時セルは休憩で全埋め(workingMin=0)、19時セルは19:30まで休憩で30分稼働
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [],
    rests: [{ startTime: '18:00', endTime: '19:30', place: 'X' }]
  }];
  const m = hourlyDowEfficiency(drives);
  const dow = 4; // 木曜
  assert.equal(m[dow][18].workingMin, 0, '18時セルは休憩で全埋め');
  assert.equal(m[dow][19].workingMin, 30, '19時セルは19:30まで休憩、30分間稼働');
});

test('hourlyDowEfficiency: hourlyA は workingMin ベース(売上÷実稼働時間)', () => {
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:30', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount: 3000, isPickup: true, isCancel: false, waitTime: '' }],
    rests: [{ startTime: '18:00', endTime: '19:30', place: 'X' }]
  }];
  const m = hourlyDowEfficiency(drives);
  const dow = 4;
  // 19時セル: workingMin=30, sales=3000, hourlyA = 3000 / (30/60) = 6000
  assert.equal(m[dow][19].sales, 3000);
  assert.equal(m[dow][19].workingMin, 30);
  assert.equal(m[dow][19].hourlyA, 6000);
});

test('hourlyDowEfficiency: hourlyB は削除されている', () => {
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [],
    rests: []
  }];
  const m = hourlyDowEfficiency(drives);
  assert.equal(m[4][18].hourlyB, undefined, 'hourlyB プロパティは削除済み');
});

import {
  coefficientOfVariation, stabilityTier, classifyEarning
} from '../js/chart-helpers.js';

test('coefficientOfVariation: 標準偏差/平均。全て同値ならCV=0', () => {
  assert.equal(coefficientOfVariation([100, 100, 100]), 0);
});

test('coefficientOfVariation: 空配列や平均0は0を返す', () => {
  assert.equal(coefficientOfVariation([]), 0);
  assert.equal(coefficientOfVariation([0, 0]), 0);
});

test('coefficientOfVariation: 既知値（母集団標準偏差）', () => {
  // values [2,4,4,4,5,5,7,9]: mean=5, 母分散=4, std=2, CV=0.4
  assert.equal(coefficientOfVariation([2,4,4,4,5,5,7,9]), 0.4);
});

test('stabilityTier: 3件未満は insufficient', () => {
  assert.equal(stabilityTier([100, 100]), 'insufficient');
  assert.equal(stabilityTier([]), 'insufficient');
});

test('stabilityTier: CV<=0.3=stable, <=0.6=mid, >0.6=volatile', () => {
  assert.equal(stabilityTier([100, 100, 100]), 'stable');        // CV=0
  assert.equal(stabilityTier([2,4,4,4,5,5,7,9]), 'mid');          // CV=0.4
  assert.equal(stabilityTier([10, 50, 100]), 'volatile');        // CV>0.6
});

test('classifyEarning: 有効値分布の上位1/3=earn, 下位1/3=rest, 中間=normal', () => {
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90]; // 9件
  assert.equal(classifyEarning(90, vals), 'earn');   // 最上位
  assert.equal(classifyEarning(80, vals), 'earn');   // pct=7/9>=2/3
  assert.equal(classifyEarning(50, vals), 'normal'); // pct=4/9
  assert.equal(classifyEarning(10, vals), 'rest');   // pct=0
  assert.equal(classifyEarning(20, vals), 'rest');   // pct=1/9<1/3
});

test('classifyEarning: 値0や有効値3件未満は none', () => {
  assert.equal(classifyEarning(0, [10, 20, 30]), 'none');
  assert.equal(classifyEarning(50, [50, 60]), 'none');
});

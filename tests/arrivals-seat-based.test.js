// 人数の表示を「推定の降客数」から「定員(座席数)」へ切り替える
//
// 背景: これまでの「◯人」は 座席数 × 搭乗率0.7(決め打ち) で作った推定だった。
// 搭乗率は実測ではなく固定値(データ上も loadFactorSource: "default")。
// 本人指示「実数は表示」に合わせ、数えられる値である座席数に置きかえる。
// 混雑の色分けのしきい値も同じ比率(1/0.7)で上げ、見え方を変えない。
import { test } from 'node:test';
import assert from 'node:assert';
import { aggregateHeatmapClient, summarizeFlights, DENSITY_HIGH, DENSITY_MID } from '../tools/js/arrivals-data.js';

const f = (over = {}) => ({
  scheduledTime: '10:00', estimatedTime: '10:00', status: '到着',
  seatCount: 300, estimatedPax: 210, isInternational: false, ...over,
});

test('時間帯別の人数は、座席数の合計になる', () => {
  const bins = aggregateHeatmapClient([f(), f({ seatCount: 200, estimatedPax: 140 })]);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].totalPax, 500, '300+200 の座席数（210+140 の推定ではない）');
});

test('国際線の内訳も座席数で数える', () => {
  const bins = aggregateHeatmapClient([
    f({ isInternational: true, seatCount: 250, estimatedPax: 175 }),
    f({ seatCount: 100, estimatedPax: 70 }),
  ]);
  assert.equal(bins[0].totalPax, 350);
  assert.equal(bins[0].internationalPax, 250);
});

test('座席数が分からない便は「不明」に数え、合計には足さない', () => {
  const bins = aggregateHeatmapClient([f(), f({ seatCount: null, estimatedPax: null })]);
  assert.equal(bins[0].totalPax, 300);
  assert.equal(bins[0].unknownCount, 1);
  assert.equal(bins[0].flightCount, 2);
});

test('欠航便は座席数に足さない', () => {
  const bins = aggregateHeatmapClient([f(), f({ status: '欠航' })]);
  assert.equal(bins[0].totalPax, 300);
  assert.equal(bins[0].cancelledCount, 1);
  assert.equal(bins[0].flightCount, 1);
});

test('集計(上の帯)も座席数の合計になる', () => {
  const s = summarizeFlights([f(), f({ seatCount: 200, estimatedPax: 140 })], { windowHours: 2, windowLabel: 'x' });
  assert.equal(s.totalPax, 500);
  assert.equal(s.hourlyAvg, 250, '500 ÷ 2時間');
});

test('混雑の色分けは、座席数に合わせてしきい値を上げる', () => {
  // 搭乗率0.7 ぶん(1/0.7 ≒ 1.43倍)。以前は 300/600 だった。
  assert.equal(DENSITY_MID, 430);
  assert.equal(DENSITY_HIGH, 860);
});

test('色分けの結果は、置きかえ前と同じに保たれる', () => {
  // 以前「推定300人 = mid」だった状況は、座席430で mid のまま。
  const mid = aggregateHeatmapClient([f({ seatCount: 430, estimatedPax: 301 })]);
  assert.equal(mid[0].densityTier, 'mid');
  const high = aggregateHeatmapClient([f({ seatCount: 860, estimatedPax: 602 })]);
  assert.equal(high[0].densityTier, 'high');
  const low = aggregateHeatmapClient([f({ seatCount: 200, estimatedPax: 140 })]);
  assert.equal(low[0].densityTier, 'low');
});

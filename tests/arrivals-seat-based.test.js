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

test('色分けは30分コマの定員合計で決まる', () => {
  // 1便だけの薄いコマは「少ない」。実データの深夜がこの形。
  const low = aggregateHeatmapClient([f({ seatCount: 300 })]);
  assert.equal(low[0].densityTier, 'low');
  // 昼のピークは複数便が重なって数千になる。
  const high = aggregateHeatmapClient([
    f({ seatCount: 500 }), f({ seatCount: 500 }), f({ seatCount: 500 }),
    f({ seatCount: 500 }), f({ seatCount: 500 }), f({ seatCount: 500 }),
    f({ seatCount: 500 }),
  ]);
  assert.equal(high[0].totalPax, 3500);
  assert.equal(high[0].densityTier, 'high');
});

// --- 色分けの境目を実際の値に合わせる ---
// これまでの境目(430/860)は、1便あたりの感覚で置かれていて、30分コマの実値
// (昼は3000〜4400)から見るとはるか下だった。結果ほぼ全部が「多い」に振り切れ、
// 色を見ても空いている時間帯が分からなかった。
// 7日ぶん(T1+T2・30分コマ)の実測: 25% 2100 / 中央 2900 / 75% 3600。
// 三等分になる 2500 / 3500 に引き直した(実測で 31% / 39% / 31%)。
import { classifyDensityFor } from '../tools/js/arrivals-data.js';

test('境目は実データの三等分に合わせる', () => {
  assert.equal(DENSITY_MID, 2500);
  assert.equal(DENSITY_HIGH, 3500);
});

test('深夜の薄い時間帯は「少ない」', () => {
  // 実測の中央値: 3時台 215 / 5時台 430 / 23時台 1051
  assert.equal(classifyDensityFor(215), 'low');
  assert.equal(classifyDensityFor(1051), 'low');
});

test('昼のふつうの時間帯は「普通」', () => {
  // 実測: 15時台 3070 / 19時台 2991
  assert.equal(classifyDensityFor(3070), 'mid');
  assert.equal(classifyDensityFor(2991), 'mid');
});

test('ピークは「多い」', () => {
  // 実測: 9時台 4416 / 18時台 4233
  assert.equal(classifyDensityFor(4416), 'high');
  assert.equal(classifyDensityFor(4233), 'high');
});

test('境目ちょうどは上の段に入れる', () => {
  assert.equal(classifyDensityFor(2500), 'mid');
  assert.equal(classifyDensityFor(3500), 'high');
  assert.equal(classifyDensityFor(2499), 'low');
});

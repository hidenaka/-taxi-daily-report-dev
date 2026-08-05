// 「概算（合計のみ）で入れた乗務」が売上集計にどう混ざるかのテスト。
//
// 背景（2026-08-06・本番データで実測）:
// 日報の写真が読めないときは「合計のみ」で登録できる。この乗務は明細が無く、
// 売上は手入力の総額（＝概算）。当月度は 8 乗務のうち 5 件が概算で、金額では
// ¥494,000／¥796,190（62%）を占めていた。それがホームの「合計売上」「平均売上」に
// 混ざっているのに、画面上は普通の実績と見分けが付かなかった。
//
// ここでは
//   (1) 概算の判定（フラグが落ちた古い記録も拾う）
//   (2) 集計が概算の件数・金額を併せて返すこと
// を固定する。
import { test } from 'node:test';
import assert from 'node:assert';
import { calcDailySales, isApproxSales } from '../js/payroll.js';
import { salesAggregate, splitDrives, resolveMetrics } from '../js/home-metrics.js';

const detailed = (date, amount) => ({
  date, vehicleType: 'japantaxi',
  trips: [{ amount, isCancel: false }], rests: [],
});
const approx = (date, total) => ({
  date, vehicleType: 'japantaxi',
  _summaryOnly: true, totalSales: total, trips: [], rests: [],
});
// 旧「合計のみ」記録などでフラグが落ちた形（明細ゼロ・総額だけある）
const approxNoFlag = (date, total) => ({
  date, vehicleType: 'japantaxi',
  totalSales: total, trips: [], rests: [],
});

test('isApproxSales: 合計のみ乗務を概算と判定する', () => {
  assert.equal(isApproxSales(approx('2026-08-01', 100000)), true);
  assert.equal(isApproxSales(detailed('2026-08-02', 50000)), false);
  assert.equal(isApproxSales(null), false);
});

test('isApproxSales: フラグが落ちていても、明細ゼロ＋総額ありなら概算とみなす', () => {
  assert.equal(isApproxSales(approxNoFlag('2026-08-03', 70000)), true);
});

test('calcDailySales: フラグが落ちた合計のみ乗務を 0 円にしない（売上が消えるバグ）', () => {
  assert.equal(calcDailySales(approxNoFlag('2026-08-03', 70000)).inclTax, 70000);
  // 明細も総額も無い乗務は 0 のまま
  assert.equal(calcDailySales({ date: '2026-08-04', trips: [], rests: [] }).inclTax, 0);
});

test('salesAggregate: 概算の件数と金額を併せて返す', () => {
  const a = salesAggregate([
    detailed('2026-08-01', 50000),
    approx('2026-08-02', 100000),
    approx('2026-08-03', 90000),
  ]);
  assert.equal(a.count, 3);
  assert.equal(a.totalIncl, 240000, '概算ぶんも合計に入る（従来どおり）');
  assert.equal(a.approxCount, 2, '概算の件数');
  assert.equal(a.approxIncl, 190000, '概算ぶんの金額');
});

test('salesAggregate: 概算が無ければ 0 件・0 円', () => {
  const a = salesAggregate([detailed('2026-08-01', 50000)]);
  assert.equal(a.approxCount, 0);
  assert.equal(a.approxIncl, 0);
});

test('resolveMetrics: 合計・平均の数値に概算の内訳が付く', () => {
  const drives = [
    detailed('2026-08-01', 50000),
    approx('2026-08-02', 100000),
  ];
  const config = {
    takeHomeRate: 0.75, responsibilityShifts: 11,
    payrollMode: 'fixed_rate', fixedRate: 0.55,
    premiumIncentive: { thresholdSalesExclTax: 0, amount: 0 },
  };
  const v = resolveMetrics(drives, config, '2026-07-16', '2026-08-15', 11);

  for (const id of ['resp.total.incl', 'resp.avg.incl', 'month.total.incl']) {
    assert.equal(v[id].approxCount, 1, `${id} に概算件数が付く`);
    assert.equal(v[id].approxIncl, 100000, `${id} に概算金額が付く`);
  }
  // 公出(12出番目〜)は該当なし
  assert.equal(v['kosyutsu.total.incl'].approxCount, 0);
});

test('splitDrives: 責任(1〜11)と公出(12〜)で概算件数が混ざらない', () => {
  const drives = [];
  for (let i = 1; i <= 11; i++) drives.push(detailed(`2026-08-${String(i).padStart(2, '0')}`, 50000));
  drives.push(approx('2026-08-12', 80000)); // 12乗務目＝公出
  const { resp, kosyutsu } = splitDrives(drives);
  assert.equal(salesAggregate(resp).approxCount, 0);
  assert.equal(salesAggregate(kosyutsu).approxCount, 1);
});

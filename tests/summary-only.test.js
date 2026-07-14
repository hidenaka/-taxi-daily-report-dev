import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryOnly } from '../js/chart-helpers.js';
import { calcDailySales, calcMonthlySales } from '../js/payroll.js';

test('isSummaryOnly: _summaryOnly フラグ付きの drive は true', () => {
  assert.equal(isSummaryOnly({ _summaryOnly: true, totalSales: 52300, trips: [], rests: [] }), true);
});

test('isSummaryOnly: 明細ありの drive は false', () => {
  assert.equal(isSummaryOnly({ trips: [{ amount: 1000, boardTime: '09:00' }], rests: [] }), false);
});

test('isSummaryOnly: 後方互換 _importedFrom=spreadsheet は true', () => {
  assert.equal(isSummaryOnly({ _importedFrom: 'spreadsheet', trips: [] }), true);
});

test('isSummaryOnly: trips 空の通常 drive（フラグなし）は false', () => {
  assert.equal(isSummaryOnly({ trips: [], rests: [] }), false);
});

test('calcDailySales: summary-only は totalSales を売上として使う', () => {
  const r = calcDailySales({ _summaryOnly: true, totalSales: 52300, trips: [], rests: [] });
  assert.equal(r.inclTax, 52300);
  assert.equal(r.exclTax, 52300 / 1.1);
});

test('calcDailySales: summary-only で totalSales が無ければ 0', () => {
  const r = calcDailySales({ _summaryOnly: true, trips: [] });
  assert.equal(r.inclTax, 0);
  assert.equal(r.exclTax, 0);
});

test('calcDailySales: 明細ありは従来どおり trips 合計（回帰）', () => {
  const r = calcDailySales({
    trips: [{ amount: 1000 }, { amount: 2000 }, { amount: 500, isCancel: true }]
  });
  assert.equal(r.inclTax, 3000);
});

test('calcMonthlySales: summary-only と明細ありが混在しても合算される', () => {
  const r = calcMonthlySales([
    { _summaryOnly: true, totalSales: 50000, trips: [] },
    { trips: [{ amount: 1000 }, { amount: 2000 }] }
  ]);
  assert.equal(r.inclTax, 53000);
});

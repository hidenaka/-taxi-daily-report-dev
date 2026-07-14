import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryOnly } from '../js/chart-helpers.js';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryOnly, avgTripSales } from '../js/chart-helpers.js';
import { calcDailySales, calcMonthlySales } from '../js/payroll.js';
import { buildGroupPool } from '../js/group-pool-core.js';

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

test('calcDailySales: 明細ありは trips 合計（回帰）', () => {
  const r = calcDailySales({
    trips: [{ amount: 1000 }, { amount: 2000 }, { amount: 0, isCancel: true }]
  });
  assert.equal(r.inclTax, 3000, '金額0のキャンセルは売上ゼロ');
});

// 2026-08-10 仕様変更: キャンセルでも金額が入っていれば売上に計上する
// (タクシーチケット等で営業収益が補填されるケース。詳細は cancel-with-amount.test.js)
test('calcDailySales: 補填ありキャンセル(金額入り)は売上に含める', () => {
  const r = calcDailySales({
    trips: [{ amount: 1000 }, { amount: 2000 }, { amount: 500, isCancel: true }]
  });
  assert.equal(r.inclTax, 3500);
});

test('calcMonthlySales: summary-only と明細ありが混在しても合算される', () => {
  const r = calcMonthlySales([
    { _summaryOnly: true, totalSales: 50000, trips: [] },
    { trips: [{ amount: 1000 }, { amount: 2000 }] }
  ]);
  assert.equal(r.inclTax, 53000);
});

const NOW_ISO = '2026-07-15T00:00:00.000Z';

// 明細あり drive を 1 本作る（09:00-09:30 に 3000円の乗車 1 件）
function detailedDrive(userId, date) {
  return {
    _userId: userId,
    date,
    departureTime: '08:00',
    returnTime: '18:00',
    trips: [{ boardTime: '09:00', alightTime: '09:30', boardPlace: '駅', alightPlace: '空港', km: 10, amount: 3000 }],
    rests: []
  };
}

// 合計のみ日報 drive を 1 本作る。実アプリの入力画面はヘッダー欄（出庫/帰庫時刻）が
// 明細あり/合計のみ両モード共通で、config のデフォルトにより departureTime/returnTime は
// 必ず入る（trips/rests のみが空になる）。この構造を再現しないと、hourlyDowEfficiency 内の
// isSummaryOnly ガードを経由せずとも d.departureTime/d.returnTime が無い分岐で自然に除外されて
// しまい、ガードの実効性を検証できない。
function summaryDrive(userId, date, totalSales) {
  return {
    _userId: userId,
    date,
    _summaryOnly: true,
    totalSales,
    departureTime: '08:00',
    returnTime: '18:00',
    vehicleType: 'japantaxi',
    trips: [],
    rests: []
  };
}

test('buildGroupPool: summary-only 日を混ぜても heatmap セルが増えない', () => {
  const base = [detailedDrive('u1', '2026-07-10'), detailedDrive('u2', '2026-07-10')];
  const withSummary = [
    ...base,
    summaryDrive('u1', '2026-07-11', 50000),
    summaryDrive('u2', '2026-07-11', 90000)
  ];
  const poolA = buildGroupPool(base, 2, { nowIso: NOW_ISO, months: 6 });
  const poolB = buildGroupPool(withSummary, 2, { nowIso: NOW_ISO, months: 6 });
  assert.ok(poolA.heatmap.length > 0, 'フィクスチャが非空の heatmap を生んでいること');
  assert.equal(poolB.heatmap.length, poolA.heatmap.length);
  assert.deepEqual(poolB.heatmap, poolA.heatmap);
});

test('buildGroupPool: 出力に totalSales / _summaryOnly が漏れない', () => {
  const pool = buildGroupPool(
    [detailedDrive('u1', '2026-07-10'), summaryDrive('u2', '2026-07-11', 90000)],
    2, { nowIso: NOW_ISO, months: 6 }
  );
  const json = JSON.stringify(pool);
  assert.equal(json.includes('totalSales'), false);
  assert.equal(json.includes('_summaryOnly'), false);
  assert.equal(json.includes('90000'), false);
});

test('avgTripSales: summary-only 日を分母に入れず NaN にならない', () => {
  const v = avgTripSales([
    { trips: [{ amount: 1000 }, { amount: 3000 }] },
    { _summaryOnly: true, totalSales: 50000, trips: [] }
  ]);
  assert.equal(v, 2000);
  assert.equal(Number.isNaN(v), false);
});

test('avgTripSales: summary-only 日しか無ければ 0（NaN でない）', () => {
  const v = avgTripSales([{ _summaryOnly: true, totalSales: 50000, trips: [] }]);
  assert.equal(v, 0);
});

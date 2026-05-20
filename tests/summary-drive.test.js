import { test, assert } from './run.js';
import { isSummaryDrive, extractInclTaxFare, buildSummaryDrive } from '../js/summary-drive.js';

// isSummaryDrive

test('isSummaryDrive: summaryOnly=true → true', () => {
  assert.equal(isSummaryDrive({ summaryOnly: true }), true);
});

test('isSummaryDrive: summaryOnly=false → false', () => {
  assert.equal(isSummaryDrive({ summaryOnly: false }), false);
});

test('isSummaryDrive: フィールド無し → false（既存日報互換）', () => {
  assert.equal(isSummaryDrive({ date: '2026-05-20', trips: [] }), false);
});

test('isSummaryDrive: null / undefined → false', () => {
  assert.equal(isSummaryDrive(null), false);
  assert.equal(isSummaryDrive(undefined), false);
});

test('isSummaryDrive: summaryOnly が truthy 別値 → false（厳密 ===true 判定）', () => {
  assert.equal(isSummaryDrive({ summaryOnly: 1 }), false);
  assert.equal(isSummaryDrive({ summaryOnly: 'yes' }), false);
});

// extractInclTaxFare: 合計のみ日報

test('extractInclTaxFare: summary-drive で summaryFare 数値 → そのまま返す', () => {
  assert.equal(extractInclTaxFare({ summaryOnly: true, summaryFare: 50000 }), 50000);
});

test('extractInclTaxFare: summary-drive で summaryFare 文字列 → 数値化', () => {
  assert.equal(extractInclTaxFare({ summaryOnly: true, summaryFare: '45000' }), 45000);
});

test('extractInclTaxFare: summary-drive で summaryFare 不正 → 0', () => {
  assert.equal(extractInclTaxFare({ summaryOnly: true, summaryFare: 'abc' }), 0);
  assert.equal(extractInclTaxFare({ summaryOnly: true, summaryFare: -100 }), 0);
  assert.equal(extractInclTaxFare({ summaryOnly: true }), 0);
});

// extractInclTaxFare: 明細日報

test('extractInclTaxFare: 明細日報で trips の合計', () => {
  const drive = {
    trips: [
      { amount: 5000, isCancel: false },
      { amount: 3000, isCancel: false },
      { amount: 0, isCancel: true }, // キャンセル除外
    ],
  };
  assert.equal(extractInclTaxFare(drive), 8000);
});

test('extractInclTaxFare: trips が空 → 0', () => {
  assert.equal(extractInclTaxFare({ trips: [] }), 0);
});

test('extractInclTaxFare: trips が無い → 0', () => {
  assert.equal(extractInclTaxFare({ date: '2026-05-20' }), 0);
});

test('extractInclTaxFare: null / undefined → 0', () => {
  assert.equal(extractInclTaxFare(null), 0);
  assert.equal(extractInclTaxFare(undefined), 0);
});

test('extractInclTaxFare: summaryOnly が誤って混在しても summary 優先', () => {
  // summaryOnly: true なら summaryFare を見て、trips は無視
  const drive = {
    summaryOnly: true,
    summaryFare: 50000,
    trips: [{ amount: 99999, isCancel: false }], // 無視される
  };
  assert.equal(extractInclTaxFare(drive), 50000);
});

// buildSummaryDrive

test('buildSummaryDrive: 必須フィールド + summaryOnly=true 含む', () => {
  const doc = buildSummaryDrive({
    date: '2026-05-20',
    vehicleType: 'japantaxi',
    summaryFare: 50000,
    now: '2026-05-20T12:00:00.000Z',
  });
  assert.equal(doc.date, '2026-05-20');
  assert.equal(doc.summaryOnly, true);
  assert.equal(doc.summaryFare, 50000);
  assert.deepEqual(doc.trips, []);
  assert.equal(doc.createdAt, '2026-05-20T12:00:00.000Z');
});

test('buildSummaryDrive: summaryFare 不正 → 0 で保存', () => {
  const doc = buildSummaryDrive({ date: '2026-05-20', summaryFare: 'invalid' });
  assert.equal(doc.summaryFare, 0);
});

test('buildSummaryDrive: 補助フィールド省略時の default', () => {
  const doc = buildSummaryDrive({ date: '2026-05-20', summaryFare: 30000 });
  assert.equal(doc.returnTime, null);
  assert.equal(doc.totalDistanceKm, null);
  assert.equal(doc.memo, '');
  assert.deepEqual(doc.rests, []);
  assert.deepEqual(doc.violations, []);
});

test('buildSummaryDrive: summaryFare 端数は round', () => {
  const doc = buildSummaryDrive({ date: '2026-05-20', summaryFare: 12345.6 });
  assert.equal(doc.summaryFare, 12346);
});

test('buildSummaryDrive: trips は常に空配列', () => {
  const doc = buildSummaryDrive({ date: '2026-05-20', summaryFare: 50000 });
  assert.deepEqual(doc.trips, []);
});

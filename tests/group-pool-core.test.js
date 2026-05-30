import { test } from 'node:test';
import assert from 'node:assert';
import { monthsAgoDate, selectRecentDrives } from '../js/group-pool-core.js';

test('monthsAgoDate: nowから指定月数前の YYYY-MM-DD', () => {
  assert.equal(monthsAgoDate('2026-05-30T12:00:00.000Z', 6), '2025-11-30');
});

test('selectRecentDrives: cutoff以降のdriveだけ残す', () => {
  const drives = [
    { date: '2025-10-01' }, // 6ヶ月より前 → 除外
    { date: '2025-11-30' }, // ちょうどcutoff → 含む(>=)
    { date: '2026-05-01' }, // 含む
    { date: '' },           // 不正 → 除外
    { nodate: true },       // dateなし → 除外
  ];
  const out = selectRecentDrives(drives, '2026-05-30T12:00:00.000Z', 6);
  assert.deepEqual(out.map(d => d.date), ['2025-11-30', '2026-05-01']);
});

test('selectRecentDrives: 配列以外は空配列', () => {
  assert.deepEqual(selectRecentDrives(null, '2026-05-30T00:00:00.000Z', 6), []);
});

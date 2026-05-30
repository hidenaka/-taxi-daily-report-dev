import { test } from 'node:test';
import assert from 'node:assert';
import { monthsAgoDate, selectRecentDrives, buildGroupPool } from '../js/group-pool-core.js';

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

const TRIP = (boardPlace, amount) => ({ type: 'trip', boardTime: '19:00', boardPlace, alightPlace: '港区', km: 3, amount, isPickup: false, isCancel: false });

test('buildGroupPool: メンバー2人以上で匿名itemsを返す', () => {
  const drives = [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.equal(pool.memberCount, 2);
  assert.equal(pool.builtAt, '2026-05-30T00:00:00.000Z');
  assert.equal(pool.items.length, 1);
  assert.equal(pool.items[0].pickupArea, '中央区銀座');
});

test('buildGroupPool: メンバー2人未満は空プール（min2ゲート）', () => {
  const drives = [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }];
  const pool = buildGroupPool(drives, 1, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.deepEqual(pool.items, []);
  assert.equal(pool.memberCount, 1);
});

test('buildGroupPool: 直近6ヶ月外のdriveは入らない', () => {
  const drives = [
    { date: '2024-01-01', trips: [TRIP('品川区', 1000)] }, // 古い→除外
    { date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] },
  ];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z', months: 6 });
  assert.equal(pool.items.length, 1);
});

test('buildGroupPool: maxItems で件数を上限し新しい方を残す', () => {
  const trips = Array.from({ length: 5 }, (_, i) => TRIP('港区' + i, 1000 + i));
  const drives = [{ date: '2026-05-01', trips }];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z', maxItems: 3 });
  assert.equal(pool.items.length, 3);
  // slice(末尾)で後方(新しい入力順)を残す
  assert.equal(pool.items[2].amount, 1004);
});

import { test } from 'node:test';
import assert from 'node:assert';
import { monthsAgoDate, selectRecentDrives, buildGroupPool, shouldRebuild, refreshGroupPool } from '../js/group-pool-core.js';

test('monthsAgoDate: nowから指定月数前の YYYY-MM-DD', () => {
  assert.equal(monthsAgoDate('2026-05-30T12:00:00.000Z', 6), '2025-11-30');
});

test('monthsAgoDate: 月末起点のロールオーバーを前月末にクランプ', () => {
  assert.equal(monthsAgoDate('2026-05-31T12:00:00.000Z', 6), '2025-11-30');
  assert.equal(monthsAgoDate('2026-03-31T12:00:00.000Z', 1), '2026-02-28');
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

test('shouldRebuild: プール無しは再構築', () => {
  assert.equal(shouldRebuild(null, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
});

test('shouldRebuild: builtAt無し/不正は再構築', () => {
  assert.equal(shouldRebuild({}, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
  assert.equal(shouldRebuild({ builtAt: 'bad' }, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
});

test('shouldRebuild: ttl内はfalse、ttl超でtrue', () => {
  const now = Date.parse('2026-05-30T12:00:00Z');
  assert.equal(shouldRebuild({ builtAt: '2026-05-30T11:30:00Z' }, now, 3600000), false); // 30分前
  assert.equal(shouldRebuild({ builtAt: '2026-05-30T10:30:00Z' }, now, 3600000), true);  // 90分前
});

function makeDeps(overrides = {}) {
  const writes = [];
  const deps = {
    readGroup: async () => ({ memberUserIds: ['taro', 'hanako'] }),
    readPool: async () => null,
    readMemberDrives: async (uid) => [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }],
    writePool: async (gid, pool) => { writes.push({ gid, pool }); },
    ...overrides,
  };
  return { deps, writes };
}
const OPTS = { nowIso: '2026-05-30T12:00:00.000Z', nowMs: Date.parse('2026-05-30T12:00:00.000Z'), ttlMs: 3600000 };

test('refreshGroupPool: 2人以上→再構築してwriteする', async () => {
  const { deps, writes } = makeDeps();
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'rebuilt');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pool.items.length, 2); // 2メンバー×1trip
  assert.equal(writes[0].pool.memberCount, 2);
});

test('refreshGroupPool: 新鮮なプールがあれば再構築しない(force=false)', async () => {
  const { deps, writes } = makeDeps({ readPool: async () => ({ builtAt: '2026-05-30T11:45:00.000Z', items: [], memberCount: 2 }) });
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'fresh');
  assert.equal(writes.length, 0);
});

test('refreshGroupPool: force=true なら新鮮でも再構築', async () => {
  const { deps, writes } = makeDeps({ readPool: async () => ({ builtAt: '2026-05-30T11:45:00.000Z', items: [], memberCount: 2 }) });
  const r = await refreshGroupPool(deps, 'g1', { ...OPTS, force: true });
  assert.equal(r.status, 'rebuilt');
  assert.equal(writes.length, 1);
});

test('refreshGroupPool: 2人未満は空プールをwrite', async () => {
  const { deps, writes } = makeDeps({ readGroup: async () => ({ memberUserIds: ['taro'] }) });
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'too-few');
  assert.deepEqual(writes[0].pool.items, []);
});

test('refreshGroupPool: グループ無しは no-group・writeしない', async () => {
  const { deps, writes } = makeDeps({ readGroup: async () => null });
  const r = await refreshGroupPool(deps, 'gX', OPTS);
  assert.equal(r.status, 'no-group');
  assert.equal(writes.length, 0);
});

test('refreshGroupPool: readMemberDrives に monthsAgoDate(since) を渡す', async () => {
  let seen = null;
  const { deps } = makeDeps({ readMemberDrives: async (uid, since) => { seen = since; return []; } });
  await refreshGroupPool(deps, 'g1', OPTS); // OPTS.nowIso='2026-05-30T12:00:00.000Z'
  assert.equal(seen, '2025-11-30'); // 6ヶ月前(既定months=6)
});

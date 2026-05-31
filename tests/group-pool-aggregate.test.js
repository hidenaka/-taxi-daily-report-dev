import { test } from 'node:test';
import assert from 'node:assert';
import { buildGroupPool, refreshGroupPool } from '../js/group-pool-core.js';

// 非空ヒートマップセルを生む最小drive: 19-21時乗務・19:00乗車のtrip。
// _userId はメンバー識別用（peerMedianHourlyDow が per-user 中央値を出すのに使う）。
const DRIVE = (date, uid) => ({
  _userId: uid,
  date,
  departureTime: '19:00',
  returnTime: '21:00',
  trips: [{ type: 'trip', boardTime: '19:00', alightTime: '19:30', boardPlace: '中央区銀座8', alightPlace: '港区', amount: 3000, isCancel: false }],
});

test('buildGroupPool(集計): メンバー2人未満は空集計（min2ゲート）', () => {
  const pool = buildGroupPool([DRIVE('2026-05-04', 'taro')], 1, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.deepEqual(pool.heatmap, []);
  assert.deepEqual(pool.areas, []);
  assert.equal(pool.memberCount, 1);
  assert.equal(pool.items, undefined); // 生個別乗車itemsはもう保存しない
});

test('buildGroupPool(集計): 同一dow/hourに2人寄与→peerMedianセル', () => {
  const drives = [DRIVE('2026-05-04', 'taro'), DRIVE('2026-05-04', 'hanako')];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z' });
  const cell = pool.heatmap.find(c => c.days === 2);
  assert.ok(cell, '2人寄与セルが存在する');
  assert.equal(cell.peerValues.length, 2);
  assert.ok(cell.hourlyA > 0);
  assert.ok(Number.isInteger(cell.dow) && Number.isInteger(cell.h));
  // 個人識別子を残さない（匿名性）
  assert.equal(cell.userId, undefined);
  assert.equal(cell._userId, undefined);
});

test('buildGroupPool(集計): heatmapは days>0 の非空セルのみ', () => {
  const drives = [DRIVE('2026-05-04', 'taro'), DRIVE('2026-05-04', 'hanako')];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.ok(pool.heatmap.length > 0);
  assert.ok(pool.heatmap.every(c => c.days > 0));
});

test('buildGroupPool(集計): 6ヶ月外のdriveは集計に入らない', () => {
  const drives = [DRIVE('2024-01-01', 'taro'), DRIVE('2024-01-01', 'hanako')];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z', months: 6 });
  assert.deepEqual(pool.heatmap, []);
});

test('buildGroupPool(集計): areasはエリア集計配列', () => {
  const drives = [DRIVE('2026-05-04', 'taro'), DRIVE('2026-05-04', 'hanako')];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.ok(Array.isArray(pool.areas));
});

// --- refreshGroupPool: _userId付与 + 集計保存 ---

function makeAggDeps(overrides = {}) {
  const writes = [];
  // 実Firestoreのdriveは _userId を持たない。refreshGroupPool が付与する責務。
  const realDrive = () => ([{
    date: '2026-05-04', departureTime: '19:00', returnTime: '21:00',
    trips: [{ type: 'trip', boardTime: '19:00', alightTime: '19:30', boardPlace: '中央区銀座8', alightPlace: '港区', amount: 3000, isCancel: false }],
  }]);
  const deps = {
    readGroup: async () => ({ memberUserIds: ['taro', 'hanako'] }),
    readPool: async () => null,
    readMemberDrives: async () => realDrive(),
    writePool: async (gid, pool) => { writes.push({ gid, pool }); },
    ...overrides,
  };
  return { deps, writes };
}
const OPTS = { nowIso: '2026-05-30T12:00:00.000Z', nowMs: Date.parse('2026-05-30T12:00:00.000Z'), ttlMs: 3600000 };

test('refreshGroupPool(集計): heatmap/areasを保存しitemsは保存しない', async () => {
  const { deps, writes } = makeAggDeps();
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'rebuilt');
  assert.ok(Array.isArray(writes[0].pool.heatmap));
  assert.ok(Array.isArray(writes[0].pool.areas));
  assert.equal(writes[0].pool.items, undefined);
});

test('refreshGroupPool(集計): 各メンバーdrivesに_userIdを付与しcell.days=人数', async () => {
  const { deps, writes } = makeAggDeps();
  await refreshGroupPool(deps, 'g1', OPTS);
  const cell = writes[0].pool.heatmap.find(c => c.days === 2);
  assert.ok(cell, '_userId付与で2メンバーが別人として数えられる');
});

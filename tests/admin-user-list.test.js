import { test, assert } from './run.js';
import { sortUsersByCreatedAtDesc } from '../js/admin-user-list.js';

test('sortUsersByCreatedAtDesc: 作成日の新しい順に並ぶ', () => {
  const users = [
    { userId: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'new', createdAt: '2026-07-20T00:00:00.000Z' },
    { userId: 'mid', createdAt: '2026-04-10T00:00:00.000Z' },
  ];
  assert.deepEqual(sortUsersByCreatedAtDesc(users).map(u => u.userId), ['new', 'mid', 'old']);
});

test('sortUsersByCreatedAtDesc: 作成日不明は末尾・userId昇順', () => {
  const users = [
    { userId: 'b_unknown', createdAt: null },
    { userId: 'newest', createdAt: '2026-07-20T00:00:00.000Z' },
    { userId: 'a_unknown' },
  ];
  assert.deepEqual(sortUsersByCreatedAtDesc(users).map(u => u.userId), ['newest', 'a_unknown', 'b_unknown']);
});

test('sortUsersByCreatedAtDesc: Firestore Timestamp 形式(toDate)も扱える', () => {
  const ts = (iso) => ({ toDate: () => new Date(iso) });
  const users = [
    { userId: 'iso_old', createdAt: '2026-02-01T00:00:00.000Z' },
    { userId: 'ts_new', createdAt: ts('2026-07-01T00:00:00.000Z') },
  ];
  assert.deepEqual(sortUsersByCreatedAtDesc(users).map(u => u.userId), ['ts_new', 'iso_old']);
});

test('sortUsersByCreatedAtDesc: 元配列を破壊しない', () => {
  const users = [
    { userId: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'b', createdAt: '2026-06-01T00:00:00.000Z' },
  ];
  sortUsersByCreatedAtDesc(users);
  assert.equal(users[0].userId, 'a');
});

test('sortUsersByCreatedAtDesc: 不正な日付文字列は不明扱いで末尾', () => {
  const users = [
    { userId: 'ok', createdAt: '2026-07-01T00:00:00.000Z' },
    { userId: 'broken', createdAt: 'not-a-date' },
  ];
  assert.deepEqual(sortUsersByCreatedAtDesc(users).map(u => u.userId), ['ok', 'broken']);
});

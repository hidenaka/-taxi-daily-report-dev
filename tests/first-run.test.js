import { test, assert } from './run.js';
import { shouldShowFirstRunCard, shouldMarkHasDrive, isExistingLocalRealUser } from '../js/first-run.js';

test('shouldShowFirstRunCard: 日報が無ければ true', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: false }), true);
});

test('shouldShowFirstRunCard: 日報があれば false', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: true }), false);
});

// ===== shouldMarkHasDrive =====
// 「この端末に既存データあり」印(cabis_has_drive)を保存してよいかの判定。
// サンプル(user_sample)閲覧中の件数で印を付けると、招待リンク訪問者の端末が既存ユーザーと
// 誤認され signup リダイレクトが抑止される（user_sample に着地してしまう不具合の真因）。

test('shouldMarkHasDrive: 実ユーザーのデータがあれば印を付ける', () => {
  assert.equal(shouldMarkHasDrive({ myUserId: 'taro', driveCount: 3 }), true);
});

test('shouldMarkHasDrive: user_sample 閲覧中は件数があっても印を付けない', () => {
  assert.equal(shouldMarkHasDrive({ myUserId: 'user_sample', driveCount: 10 }), false);
});

test('shouldMarkHasDrive: userId 未確定(null/空)は印を付けない', () => {
  assert.equal(shouldMarkHasDrive({ myUserId: null, driveCount: 5 }), false);
  assert.equal(shouldMarkHasDrive({ myUserId: '', driveCount: 5 }), false);
});

test('shouldMarkHasDrive: 件数 0 は印を付けない', () => {
  assert.equal(shouldMarkHasDrive({ myUserId: 'taro', driveCount: 0 }), false);
});

// ===== isExistingLocalRealUser =====
// 招待リダイレクト保護の「この端末の既存ユーザー」判定。
// 印(cabis_has_drive)があっても taxi_user_id がサンプルのままなら実ユーザーではない
// （過去に誤保存された端末の自己修復）。

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null) };
}

test('isExistingLocalRealUser: 印 + 実 userId → true（保護する）', () => {
  const s = fakeStorage({ cabis_has_drive: '1', taxi_user_id: 'taro' });
  assert.equal(isExistingLocalRealUser(s), true);
});

test('isExistingLocalRealUser: 印があっても user_sample → false（誤保存の自己修復）', () => {
  const s = fakeStorage({ cabis_has_drive: '1', taxi_user_id: 'user_sample' });
  assert.equal(isExistingLocalRealUser(s), false);
});

test('isExistingLocalRealUser: 印なし → false', () => {
  assert.equal(isExistingLocalRealUser(fakeStorage({ taxi_user_id: 'taro' })), false);
  assert.equal(isExistingLocalRealUser(fakeStorage({})), false);
});

test('isExistingLocalRealUser: 印ありでも userId 未保存 → false', () => {
  const s = fakeStorage({ cabis_has_drive: '1' });
  assert.equal(isExistingLocalRealUser(s), false);
});

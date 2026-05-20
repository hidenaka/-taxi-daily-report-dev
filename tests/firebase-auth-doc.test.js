import { test, assert } from './run.js';
import { buildNewUserDoc, filterParticipatingUserIds } from '../js/user-doc.js';

test('buildNewUserDoc: 必須フィールドを含む', () => {
  const doc = buildNewUserDoc({ userId: 'taro', companyId: 'keiho', now: '2026-05-20T12:00:00.000Z' });
  assert.equal(doc.userId, 'taro');
  assert.equal(doc.companyId, 'keiho');
  assert.equal(doc.createdAt, '2026-05-20T12:00:00.000Z');
  assert.equal(doc.isAnonymous, false);
});

test('buildNewUserDoc: participatesInAggregateAnalysis を true で初期化', () => {
  const doc = buildNewUserDoc({ userId: 'taro', companyId: null, now: '2026-05-20T12:00:00.000Z' });
  assert.equal(doc.participatesInAggregateAnalysis, true);
});

test('buildNewUserDoc: companyId が null でも壊れない', () => {
  const doc = buildNewUserDoc({ userId: 'taro', companyId: null, now: '2026-05-20T12:00:00.000Z' });
  assert.equal(doc.companyId, null);
});

test('buildNewUserDoc: companyId 未指定（undefined）は null に正規化', () => {
  const doc = buildNewUserDoc({ userId: 'taro', now: '2026-05-20T12:00:00.000Z' });
  assert.equal(doc.companyId, null);
});

test('buildNewUserDoc: now 未指定なら現在時刻のISO文字列', () => {
  const doc = buildNewUserDoc({ userId: 'taro' });
  // ISO 8601 形式かをざっくり検証
  assert.match(doc.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ====== filterParticipatingUserIds ======

test('filterParticipatingUserIds: participatesInAggregateAnalysis=true のユーザーIDだけ返す', () => {
  const docs = [
    { userId: 'taro', participatesInAggregateAnalysis: true },
    { userId: 'jiro', participatesInAggregateAnalysis: false },
    { userId: 'saburo', participatesInAggregateAnalysis: true },
  ];
  assert.deepEqual(filterParticipatingUserIds(docs), ['taro', 'saburo']);
});

test('filterParticipatingUserIds: フィールド未定義は true 扱い（マイグレ移行期間互換）', () => {
  const docs = [
    { userId: 'taro' }, // フィールド無し
    { userId: 'jiro', participatesInAggregateAnalysis: false },
  ];
  assert.deepEqual(filterParticipatingUserIds(docs), ['taro']);
});

test('filterParticipatingUserIds: userId が無い doc は除外', () => {
  const docs = [
    { participatesInAggregateAnalysis: true }, // userId 無し
    { userId: 'taro', participatesInAggregateAnalysis: true },
  ];
  assert.deepEqual(filterParticipatingUserIds(docs), ['taro']);
});

test('filterParticipatingUserIds: 空配列は空配列を返す', () => {
  assert.deepEqual(filterParticipatingUserIds([]), []);
});

test('filterParticipatingUserIds: null/undefined doc は除外', () => {
  const docs = [null, undefined, { userId: 'taro', participatesInAggregateAnalysis: true }];
  assert.deepEqual(filterParticipatingUserIds(docs), ['taro']);
});

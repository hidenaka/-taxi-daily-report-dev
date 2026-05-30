import { test } from 'node:test';
import assert from 'node:assert';
import { newGroupDoc } from '../js/group-membership.js';

test('newGroupDoc: 作成者のみメンバー・既定値', () => {
  const doc = newGroupDoc({ name: '夜勤仲間', createdBy: 'taro', inviteSlug: 'gr-abc123', nowIso: '2026-05-30T00:00:00.000Z' });
  assert.deepEqual(doc.memberUserIds, ['taro']);
  assert.equal(doc.createdBy, 'taro');
  assert.equal(doc.inviteSlug, 'gr-abc123');
  assert.equal(doc.name, '夜勤仲間');
  assert.equal(doc.requireContributionToView, false);
  assert.equal(doc.minViewContribution, 1);
  assert.equal(doc.createdAt, '2026-05-30T00:00:00.000Z');
  assert.equal(doc.updatedAt, '2026-05-30T00:00:00.000Z');
});

test('newGroupDoc: name空はデフォルト名・50字に丸め・閲覧条件指定可', () => {
  const doc = newGroupDoc({ name: '', createdBy: 'a', inviteSlug: 'gr-x', nowIso: '2026-01-01T00:00:00.000Z', requireContributionToView: true, minViewContribution: 3 });
  assert.equal(doc.name, 'グループ');
  assert.equal(doc.requireContributionToView, true);
  assert.equal(doc.minViewContribution, 3);
  const long = newGroupDoc({ name: 'あ'.repeat(80), createdBy: 'a', inviteSlug: 'gr-y', nowIso: '2026-01-01T00:00:00.000Z' });
  assert.equal(long.name.length, 50);
});

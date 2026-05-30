import { test } from 'node:test';
import assert from 'node:assert';
import { newGroupDoc, addMember, removeMember, newGroupSlug, createGroupOp, joinGroupOp, leaveGroupOp } from '../js/group-membership.js';

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

test('addMember: 追加・重複なし・非破壊', () => {
  const a = ['taro'];
  assert.deepEqual(addMember(a, 'hanako'), ['taro', 'hanako']);
  assert.deepEqual(addMember(a, 'taro'), ['taro']); // 重複追加しない
  assert.deepEqual(a, ['taro']); // 元配列は不変
  assert.deepEqual(addMember(null, 'x'), ['x']); // 非配列安全
});

test('removeMember: 除去・非破壊・非配列安全', () => {
  const a = ['taro', 'hanako'];
  assert.deepEqual(removeMember(a, 'taro'), ['hanako']);
  assert.deepEqual(a, ['taro', 'hanako']);
  assert.deepEqual(removeMember(null, 'x'), []);
});

test('newGroupSlug: gr- 接頭辞・決定的rngで再現', () => {
  let i = 0;
  const rng = () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6][i++ % 6];
  const s = newGroupSlug(rng);
  assert.ok(s.startsWith('gr-'));
  assert.equal(s.length, 'gr-'.length + 6);
});

function mkDeps(over = {}) {
  const calls = { writeGroup: [], updateMembers: [], deleteGroup: [] };
  const deps = {
    slugExists: async () => false,
    writeGroup: async (gid, doc) => { calls.writeGroup.push({ gid, doc }); },
    findGroupBySlug: async (slug) => ({ groupId: 'g1', group: { memberUserIds: ['taro'], inviteSlug: slug } }),
    updateMembers: async (gid, members, nowIso) => { calls.updateMembers.push({ gid, members, nowIso }); },
    deleteGroup: async (gid) => { calls.deleteGroup.push(gid); },
    ...over,
  };
  return { deps, calls };
}
const NOW = '2026-05-30T00:00:00.000Z';

test('createGroupOp: slug衝突を避け新groupを書く', async () => {
  const { deps, calls } = mkDeps();
  let n = 0;
  const r = await createGroupOp(deps, { userId: 'taro', name: '仲間', nowIso: NOW, genSlug: () => ['gr-aaa', 'gr-bbb'][n++] });
  assert.equal(calls.writeGroup.length, 1);
  assert.deepEqual(calls.writeGroup[0].doc.memberUserIds, ['taro']);
  assert.ok(r.groupId);
  assert.ok(r.inviteSlug.startsWith('gr-'));
});

test('createGroupOp: slug衝突時は再生成', async () => {
  let exists = 0;
  const { deps } = mkDeps({ slugExists: async () => (exists++ === 0) }); // 1回目だけ衝突
  let n = 0;
  const r = await createGroupOp(deps, { userId: 'taro', name: 'x', nowIso: NOW, genSlug: () => ['gr-dup', 'gr-ok'][n++] });
  assert.equal(r.inviteSlug, 'gr-ok');
});

test('joinGroupOp: slugでgroupを引き自分を追加', async () => {
  const { deps, calls } = mkDeps();
  const r = await joinGroupOp(deps, { userId: 'hanako', slug: 'gr-abc', nowIso: NOW });
  assert.equal(r.status, 'joined');
  assert.equal(r.groupId, 'g1');
  assert.deepEqual(calls.updateMembers[0].members, ['taro', 'hanako']);
});

test('joinGroupOp: 既メンバーは二重追加しない(already)', async () => {
  const { deps, calls } = mkDeps({ findGroupBySlug: async () => ({ groupId: 'g1', group: { memberUserIds: ['taro'] } }) });
  const r = await joinGroupOp(deps, { userId: 'taro', slug: 'gr-abc', nowIso: NOW });
  assert.equal(r.status, 'already');
  assert.equal(calls.updateMembers.length, 0);
});

test('joinGroupOp: slug不正/group無しは no-group', async () => {
  const { deps } = mkDeps({ findGroupBySlug: async () => null });
  const r = await joinGroupOp(deps, { userId: 'x', slug: 'gr-zzz', nowIso: NOW });
  assert.equal(r.status, 'no-group');
});

test('leaveGroupOp: 自分を除去・残ればupdateMembers', async () => {
  const { deps, calls } = mkDeps({ findGroupBySlug: async () => null });
  const r = await leaveGroupOp(deps, { userId: 'hanako', groupId: 'g1', nowIso: NOW, group: { memberUserIds: ['taro', 'hanako'] } });
  assert.equal(r.status, 'left');
  assert.deepEqual(calls.updateMembers[0].members, ['taro']);
  assert.equal(calls.deleteGroup.length, 0);
});

test('leaveGroupOp: 最後の1人が抜けたらgroup削除', async () => {
  const { deps, calls } = mkDeps();
  const r = await leaveGroupOp(deps, { userId: 'taro', groupId: 'g1', nowIso: NOW, group: { memberUserIds: ['taro'] } });
  assert.equal(r.status, 'deleted');
  assert.equal(calls.deleteGroup[0], 'g1');
  assert.equal(calls.updateMembers.length, 0);
});

test('createGroupOp: slug衝突が続いたら例外(無音上書きしない)', async () => {
  const { deps } = mkDeps({ slugExists: async () => true }); // 常に衝突
  let n = 0;
  await assert.rejects(
    () => createGroupOp(deps, { userId: 'taro', name: 'x', nowIso: NOW, genSlug: () => 'gr-dup' + (n++) }),
    /slug-collision-limit/
  );
});

test('newGroupDoc: 絵文字名でもコードポイント単位で丸め壊れない', () => {
  const doc = newGroupDoc({ name: '😀'.repeat(60), createdBy: 'a', inviteSlug: 'gr-e', nowIso: NOW });
  assert.equal([...doc.name].length, 50);
});

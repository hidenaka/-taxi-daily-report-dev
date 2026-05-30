// グループのメンバー操作・作成/参加/退会の純ロジック。I/Oなし。
// 実Firestoreは Worker 側で deps として注入する（テスト可能化）。
import { generateSlug } from './slug-gen.js';

// userId を memberUserIds に追加（重複なし・非破壊）。
export function addMember(memberUserIds, userId) {
  const arr = Array.isArray(memberUserIds) ? memberUserIds : [];
  return arr.includes(userId) ? arr.slice() : [...arr, userId];
}

// userId を memberUserIds から除去（非破壊）。
export function removeMember(memberUserIds, userId) {
  const arr = Array.isArray(memberUserIds) ? memberUserIds : [];
  return arr.filter((u) => u !== userId);
}

// グループ用招待slug（gr- 接頭辞・6文字）。
export function newGroupSlug(rng) {
  return generateSlug('gr-', 6, rng);
}

// 新規グループの初期ドキュメント。作成者を唯一のメンバーにする。
export function newGroupDoc({ name, createdBy, inviteSlug, nowIso, requireContributionToView = false, minViewContribution = 1 }) {
  return {
    name: ([...(name || '')].slice(0, 50).join('')) || 'グループ',
    inviteSlug,
    createdBy,
    memberUserIds: [createdBy],
    requireContributionToView: !!requireContributionToView,
    minViewContribution: Number(minViewContribution) || 1, // 0/不正は1に正規化（最低1件）
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// 作成: 衝突しない slug を引き当て、作成者のみメンバーの group を書く。
// deps.slugExists / deps.writeGroup を使う。genSlug() は slug 文字列を返す関数（注入でテスト可能）。
// groupId は slug をそのまま使う（gr-XXXXXX はランダムで一意性高い）。
export async function createGroupOp(deps, { userId, name, nowIso, requireContributionToView, minViewContribution, genSlug }) {
  let slug = genSlug();
  let guard = 0;
  while (await deps.slugExists(slug)) {
    if (guard++ >= 5) throw new Error('slug-collision-limit');
    slug = genSlug();
  }
  const groupId = slug; // slug を ID に流用
  const doc = newGroupDoc({ name, createdBy: userId, inviteSlug: slug, nowIso, requireContributionToView, minViewContribution });
  await deps.writeGroup(groupId, doc);
  return { groupId, inviteSlug: slug };
}

// 参加: slug から group を引き、自分を memberUserIds に追加。
export async function joinGroupOp(deps, { userId, slug, nowIso }) {
  const found = await deps.findGroupBySlug(slug);
  if (!found) return { status: 'no-group' };
  const members = Array.isArray(found.group.memberUserIds) ? found.group.memberUserIds : [];
  if (members.includes(userId)) return { status: 'already', groupId: found.groupId };
  const next = addMember(members, userId);
  await deps.updateMembers(found.groupId, next, nowIso);
  return { status: 'joined', groupId: found.groupId };
}

// 退会: 自分を除去。残り0なら group(とpool) を削除。
//   group は呼び出し側(Worker)が読んで渡す（{memberUserIds}）。
export async function leaveGroupOp(deps, { userId, groupId, nowIso, group }) {
  const members = Array.isArray(group?.memberUserIds) ? group.memberUserIds : [];
  if (!members.includes(userId)) return { status: 'not-a-member' };
  const next = removeMember(members, userId);
  if (next.length === 0) {
    await deps.deleteGroup(groupId);
    return { status: 'deleted' };
  }
  await deps.updateMembers(groupId, next, nowIso);
  return { status: 'left' };
}

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
    name: ((name || '').slice(0, 50)) || 'グループ',
    inviteSlug,
    createdBy,
    memberUserIds: [createdBy],
    requireContributionToView: !!requireContributionToView,
    minViewContribution: Number(minViewContribution) || 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

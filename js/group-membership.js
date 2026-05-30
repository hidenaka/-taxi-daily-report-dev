// グループのメンバー操作・作成/参加/退会の純ロジック。I/Oなし。
// 実Firestoreは Worker 側で deps として注入する（テスト可能化）。
import { generateSlug } from './slug-gen.js';

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

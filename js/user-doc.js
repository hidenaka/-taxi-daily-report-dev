// users/{uid} ドキュメントの純関数ヘルパー
// firebase-auth.js は Firebase SDK の URL を import するため Node test できない
// 純関数だけ別ファイルに分離してテスト容易化する。

// 新規ユーザー doc の純関数
// participatesInAggregateAnalysis は default true（C案・既存挙動と等価）
// referredBy は紹介リンク経由の signup 時のみ含める（任意フィールド）
export function buildNewUserDoc({ userId, companyId, now, referredBy } = {}) {
  const doc = {
    userId,
    companyId: companyId ?? null,
    createdAt: now || new Date().toISOString(),
    isAnonymous: false,
    participatesInAggregateAnalysis: true,
  };
  if (referredBy) doc.referredBy = referredBy;
  return doc;
}

// users コレクションの doc 配列から「ベンチマーク統合分析に参加している」ユーザーIDを抽出
// participatesInAggregateAnalysis が未定義の doc は true 扱い（マイグレ移行期間互換）
export function filterParticipatingUserIds(userDocs) {
  if (!Array.isArray(userDocs)) return [];
  return userDocs
    .filter(d => d && d.userId && d.participatesInAggregateAnalysis !== false)
    .map(d => d.userId);
}

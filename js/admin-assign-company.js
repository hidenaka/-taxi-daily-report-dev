// admin「ユーザーを会社に所属させる」純ロジック。DOM/Firestore に触れない（テスト可能）。

// 割り当て/解除の書き込み計画を返す。
// userDoc: { uid, userId, companyId?, ... } 対象ユーザー行のデータ
// targetSlug: 会社slug。'__none__' / '' / null / undefined はクリア（所属解除）。
// companyDoc: companies一覧から見つけた該当会社 { id, freeForInvited? } または null
// 返り値: { uid, userId, companyId: string|null, grantFree: boolean, cleared: boolean }
export function buildAssignActions(userDoc, targetSlug, companyDoc) {
  const slug = (targetSlug && targetSlug !== '__none__') ? String(targetSlug) : null;
  return {
    uid: userDoc.uid,
    userId: userDoc.userId,
    companyId: slug,
    grantFree: Boolean(slug) && companyDoc?.freeForInvited === true,
    cleared: slug === null
  };
}

// 確認ダイアログ用の文言。
export function formatAssignConfirm(userDoc, actions) {
  const who = `${userDoc.userId}（uid:${String(userDoc.uid).slice(0, 8)}）`;
  if (actions.cleared) {
    return `${who} の会社所属を解除します。よろしいですか？`;
  }
  const free = actions.grantFree ? '\n＋ この会社は無償のため、恒久無料アクセスも付与します。' : '';
  return `${who} を会社「${actions.companyId}」に所属させます。${free}\nよろしいですか？`;
}

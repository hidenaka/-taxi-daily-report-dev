// 管理画面ユーザー一覧の表示順ロジック（純関数・tests/admin-user-list.test.js で検証）。

// createdAt を epoch ms に正規化する。ISO文字列と Firestore Timestamp(toDate) の両対応。
// 不明・不正は 0（＝最古扱いで末尾に沈む）。
function createdAtMs(v) {
  if (!v) return 0;
  if (typeof v.toDate === 'function') {
    const t = v.toDate().getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

// 作成日(createdAt)の新しい順。作成日不明は末尾に userId 昇順で並べる。
// 元配列は変更しない。
export function sortUsersByCreatedAtDesc(users) {
  return [...users].sort((a, b) => {
    const ta = createdAtMs(a.createdAt);
    const tb = createdAtMs(b.createdAt);
    if (tb !== ta) return tb - ta;
    return (a.userId || '').localeCompare(b.userId || '');
  });
}

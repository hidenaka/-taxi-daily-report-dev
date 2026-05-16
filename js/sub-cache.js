// js/sub-cache.js — サブスクリプション状態のセッションキャッシュ
//
// enforceAccess（access-control.js）が各ツールページで毎回 Firebase SDK ロード +
// 認証復元 + Firestore 往復（約900ms）を行いツール切り替えがもっさりする問題への対策。
// サブスク状態を sessionStorage にキャッシュし、2回目以降は Firebase に触れず即表示する。
//
// sessionStorage はタブ単位。ツール間遷移は同一タブ＝同一セッションのためヒットする。
// 改ざんされても実害なし（Firestore セキュリティルールがサーバ側の最終防御。
// enforceAccess は UX ガードに過ぎず、バックグラウンド再検証が捏造を即是正する）。

export const SUB_CACHE_KEY = 'taxi_sub_cache_v1';
export const SUB_CACHE_TTL_MS = 90 * 1000;

// キャッシュエントリが有効期限内か。純関数（nowMs を注入可能・テスト対象）。
export function isSubCacheFresh(entry, nowMs) {
  if (!entry || entry.v !== 1 || typeof entry.cachedAt !== 'number') return false;
  return (nowMs - entry.cachedAt) < SUB_CACHE_TTL_MS;
}

// sessionStorage からキャッシュエントリを読む。未設定・破損時は null（＝ミス扱い）。
export function readSubCache() {
  try {
    const raw = sessionStorage.getItem(SUB_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return (entry && entry.v === 1) ? entry : null;
  } catch {
    return null;
  }
}

// サブスク状態をキャッシュに書く。userId と取得時刻を添える。
export function writeSubCache(userId, sub) {
  try {
    sessionStorage.setItem(SUB_CACHE_KEY, JSON.stringify({
      v: 1,
      userId: userId ?? null,
      sub: sub ?? null,
      cachedAt: Date.now(),
    }));
  } catch {
    // quota 超過等は無視（キャッシュ無し＝従来どおりのブロッキング検証にフォールバック）
  }
}

// キャッシュを破棄（ログアウト・アカウント切替・申込/退会・失効検出時に呼ぶ）。
export function clearSubCache() {
  try {
    sessionStorage.removeItem(SUB_CACHE_KEY);
  } catch {
    // ignore
  }
}

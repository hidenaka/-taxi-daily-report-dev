// 会社識別の招待URL機構。
// 完全招待制（decisions 6）: `?company=<slug>` クエリで来たユーザーのみ signup 可。
// 招待URLなしで login.html?mode=signup を直叩きされたケースは signup ガードで弾く。
//
// 4つの純関数 + 1つの Firestore 依存関数。
// 純関数は tests/invite-url.test.js で網羅テスト。

const STORAGE_KEY = 'taxi_pending_company';
const SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;

// URL の `?company=<slug>` を読み取り storage に保存。正常 slug のみ受理。
// searchParams: URLSearchParams 互換 (`.get(key)`)
// storage: Web Storage 互換 (`.setItem(k, v)`)
// 戻り値: 受理した slug、なければ null
export function captureInviteSlug(searchParams, storage) {
  const raw = searchParams.get('company');
  if (raw && SLUG_PATTERN.test(raw)) {
    storage.setItem(STORAGE_KEY, raw);
    return raw;
  }
  return null;
}

// storage から保存済み招待 slug を読む。形式チェック付き（防御的）。
export function loadInviteSlug(storage) {
  const slug = storage.getItem(STORAGE_KEY);
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

// storage から招待 slug を削除する。
export function clearInviteSlug(storage) {
  storage.removeItem(STORAGE_KEY);
}

// 招待 slug が companies コレクションに存在するかを検証する。
// fetchCompanyExists: async (slug) => boolean ─ Firestore 取得を依存注入してテスト可能に。
export async function validateInviteSlug(slug, fetchCompanyExists) {
  if (!slug) return false;
  try {
    return !!(await fetchCompanyExists(slug));
  } catch {
    return false;
  }
}

// Firestore 実装版。プロダクション用のショートカット。
// db: Firestore インスタンス（firebase-init.js の db を渡す）
// firestoreFns: { doc, getDoc } を渡す（Firestore SDK の関数）
export function makeFirestoreFetcher(db, firestoreFns) {
  const { doc, getDoc } = firestoreFns;
  return async (slug) => {
    const snap = await getDoc(doc(db, 'companies', slug));
    return snap.exists();
  };
}

// 即利用できる Firestore 版 fetcher。各ページからこれを直接呼ぶことで配線を簡素化。
// 動的 import なので unit test 時の Firebase 依存を避けられる（純関数群はトップ import）。
export async function fetchCompanyExists(slug) {
  const { db } = await import('./firebase-init.js');
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const snap = await getDoc(doc(db, 'companies', slug));
  return snap.exists();
}

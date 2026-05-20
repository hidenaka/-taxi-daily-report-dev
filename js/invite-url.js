// 会社識別の招待URL機構。
// 完全招待制（decisions 6）: `?company=<slug>` クエリで来たユーザーのみ signup 可。
// 招待URLなしで login.html?mode=signup を直叩きされたケースは signup ガードで弾く。
//
// 4つの純関数 + 1つの Firestore 依存関数。
// 純関数は tests/invite-url.test.js で網羅テスト。

const STORAGE_KEY = 'taxi_pending_company';
const REF_KEY = 'taxi_pending_referrer';
const SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;
// 紹介者の userId 形式: js/firebase-auth.js / userid.js と一致させる
const REF_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;

// URL の `?company=<slug>` を読み取り storage に保存。正常 slug のみ受理。
// `?ref=<userId>` があれば紹介者として別キーに保存（任意・形式チェックで防御的）。
// searchParams: URLSearchParams 互換 (`.get(key)`)
// storage: Web Storage 互換 (`.setItem(k, v)`)
// 戻り値: 受理した slug、なければ null
export function captureInviteSlug(searchParams, storage) {
  const raw = searchParams.get('company');
  let slug = null;
  if (raw && SLUG_PATTERN.test(raw)) {
    storage.setItem(STORAGE_KEY, raw);
    slug = raw;
  }
  // 紹介者は company と独立して捕捉してOK（slug 不正でも ref だけ保存しない方針：companyが正なら ref 受理）
  if (slug) {
    const ref = searchParams.get('ref');
    if (ref && REF_PATTERN.test(ref)) {
      storage.setItem(REF_KEY, ref);
    }
  }
  return slug;
}

// storage から保存済み招待 slug を読む。形式チェック付き（防御的）。
export function loadInviteSlug(storage) {
  const slug = storage.getItem(STORAGE_KEY);
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

// storage から保存済み紹介者 userId を読む。形式チェック付き（防御的）。
export function loadReferrer(storage) {
  const ref = storage.getItem(REF_KEY);
  return ref && REF_PATTERN.test(ref) ? ref : null;
}

// storage から招待 slug を削除する（紹介者も同時に削除）。
export function clearInviteSlug(storage) {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(REF_KEY);
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

// 簡易 HTML エスケープ（slug を画面表示する用）。
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 不正招待 URL を踏んだ時に画面最上部へ表示する警告 banner。
// 二重表示防止 + ×ボタンでユーザー側からも閉じられる。
export function showInviteIssueBanner(html) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('invite-issue-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'invite-issue-banner';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;background:#fee2e2;border-bottom:1px solid #fca5a5;'
    + 'color:#991b1b;padding:10px 40px 10px 16px;font-size:13px;line-height:1.5;z-index:10000;'
    + 'text-align:center;font-weight:500;';
  banner.innerHTML = html
    + ' <button type="button" aria-label="閉じる" '
    + 'style="position:absolute;right:8px;top:6px;background:transparent;border:none;color:#991b1b;'
    + 'font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;">×</button>';
  banner.querySelector('button').addEventListener('click', () => banner.remove());
  document.body.appendChild(banner);
}

// 招待URL を捕捉し、Firestore で存在検証 → 不正なら localStorage クリア + 警告 banner 表示。
// 全ページ共通の呼出口。fire and forget（await 不要、UI ブロックしない）。
export async function checkInviteAndWarn(searchParams, storage, fetchCompanyExistsFn) {
  const slug = captureInviteSlug(searchParams, storage);
  if (!slug) return; // 招待URLパラメータなし → 何もしない
  const valid = await validateInviteSlug(slug, fetchCompanyExistsFn);
  if (valid) return; // 有効 → そのまま localStorage 保持
  clearInviteSlug(storage);
  showInviteIssueBanner(
    '⚠️ 招待URL <code style="background:#fff;padding:1px 4px;border-radius:3px;font-family:monospace;">?company=' + escapeHtml(slug) + '</code> が無効です。'
    + ' 担当者にURLをご確認のうえ、改めてアクセスしてください。'
    + ' お問い合わせ: <a href="mailto:cabis@taxicabis.com" style="color:#991b1b;text-decoration:underline;">cabis@taxicabis.com</a>'
  );
}

// グループUI用クライアント。純ヘルパ + Worker/Firestore 呼び出しラッパ。
// 招待URL生成・slug解析・Workerベース解決は純粋（テスト可能）。
const SLUG_RE = /^gr-[a-z0-9]{4,12}$/;

// 招待URL = <base>/groups.html?group=<slug>
export function buildGroupInviteUrl(slug, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/groups.html?group=${encodeURIComponent(slug)}`;
}

// ?group=<slug> から gr- 形式の slug だけ受理（不正は null）。
export function parseGroupSlug(searchParams) {
  const raw = searchParams && searchParams.get ? searchParams.get('group') : null;
  return raw && SLUG_RE.test(raw) ? raw : null;
}

// Worker のベースURLを dev/prod 判定で返す。loc = {hostname, pathname}（既定 location）。
export function resolveWorkerBase(loc = (typeof location !== 'undefined' ? location : {})) {
  const host = loc.hostname || '';
  const path = loc.pathname || '';
  const isDev = host.includes('-dev') || path.includes('-dev') || host === 'localhost' || host === '127.0.0.1';
  return isDev
    ? 'https://cabis-billing-dev.haqei64384.workers.dev'
    : 'https://cabis-billing.haqei64384.workers.dev';
}

// Worker への認証付きPOST（fetch 注入可・テスト用）。json を返す（status は呼び側で見る）。
export async function callWorker(workerBase, path, body, idToken, fetchImpl = fetch) {
  const res = await fetchImpl(workerBase + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

// 以下は実行時に auth/db を渡して使う薄いラッパ（ブラウザ専用・ユニットテスト対象外）。
//   ctx = { idToken, workerBase }
export function createGroup(ctx, { name, requireContributionToView, minViewContribution }) {
  return callWorker(ctx.workerBase, '/group-create', { name, requireContributionToView, minViewContribution }, ctx.idToken);
}
export function joinGroup(ctx, slug) {
  return callWorker(ctx.workerBase, '/group-join', { slug }, ctx.idToken);
}
export function leaveGroup(ctx, groupId) {
  return callWorker(ctx.workerBase, '/group-leave', { groupId }, ctx.idToken);
}
export function refreshPool(ctx, groupId, force = false) {
  return callWorker(ctx.workerBase, '/group-pool-refresh', { groupId, force }, ctx.idToken);
}

// 自分が所属する groups を Firestore から取得（memberUserIds array-contains 自分のuserId）。
//   fs = firestore モジュール, db, myUserId
export async function listMyGroups(fs, db, myUserId) {
  const q = fs.query(fs.collection(db, 'groups'), fs.where('memberUserIds', 'array-contains', myUserId));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ groupId: d.id, ...d.data() }));
}

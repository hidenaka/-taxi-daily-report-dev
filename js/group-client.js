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

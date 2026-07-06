import { DEFAULT_USER_ID, isValidUserId, normalizeUserId } from './userid.js';
import { getBillingPeriodRange } from './app.js';
import { getCached, setCached, delCached, notifyChanged, notifyRefresh } from './cache.js';

const API_BASE = 'https://api.github.com';

const USER_ID_KEY = 'taxi_user_id';

export function getMyUserId() {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (!raw) return DEFAULT_USER_ID;
  const norm = normalizeUserId(raw);
  return isValidUserId(norm) ? norm : DEFAULT_USER_ID;
}

export function setMyUserId(id) {
  const norm = normalizeUserId(id);
  if (!isValidUserId(norm)) {
    throw new Error('userId は英小文字または数字始まりで英小文字・数字・アンダースコアのみ使用可');
  }
  localStorage.setItem(USER_ID_KEY, norm);
  return norm;
}

function getToken() {
  return localStorage.getItem('github_token');
}

export function getRepo() {
  // データリポ（"username/taxi-daily-report-data"）。コードリポではない点注意。
  return localStorage.getItem('github_data_repo');
}

function authHeaders() {
  const token = getToken();
  if (!token) throw new Error('GitHub token未設定');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// インフライトリクエスト dedup（同じpath/dirへの並行fetchを1本に集約）
const inflightFile = new Map();
const inflightList = new Map();

// 単一ファイルを取得 → JSONパース済みで返す
export async function getFile(path) {
  if (inflightFile.has(path)) return inflightFile.get(path);
  const p = (async () => {
    const repo = getRepo();
    const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, {
      headers: authHeaders()
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    const result = { content: JSON.parse(decoded), sha: data.sha };
    setCached(`file:${path}`, result.content, result.sha);
    return result;
  })().finally(() => inflightFile.delete(path));
  inflightFile.set(path, p);
  return p;
}

// ディレクトリ内のファイル一覧
export async function listFiles(dir) {
  if (inflightList.has(dir)) return inflightList.get(dir);
  const p = (async () => {
    const repo = getRepo();
    const res = await fetch(`${API_BASE}/repos/${repo}/contents/${dir}`, {
      headers: authHeaders()
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const list = await res.json(); // [{ name, path, sha, ... }]
    setCached(`list:${dir}`, list);
    return list;
  })().finally(() => inflightList.delete(dir));
  inflightList.set(dir, p);
  return p;
}

// ===== Cache 利用ヘルパ =====

// キャッシュ済みファイルを返す（ない/破損/エラーは null）。fetch しない
export function getFileCached(path) {
  const c = getCached(`file:${path}`);
  if (!c) return null;
  return { content: c.value, sha: c.sha };
}
export function getListCached(dir) {
  const c = getCached(`list:${dir}`);
  return c ? c.value : null;
}

// list を取得しつつキャッシュ
export async function listFilesFresh(dir) {
  return listFiles(dir);
}

// 個別ファイル: sha が一致したらキャッシュをそのまま使い、API は叩かない
async function getFileBySha(path, expectedSha) {
  const cached = getFileCached(path);
  if (cached && expectedSha && cached.sha === expectedSha) return cached;
  return getFile(path);
}

export async function getConfig() {
  const userId = getMyUserId();
  const result = await getFile(`data/config/${userId}.json`);
  return result?.content || null;
}

export async function getDrive(date) {
  const userId = getMyUserId();
  const result = await getFile(`data/drives/${userId}/${date}.json`);
  return result?.content || null;
}

// 月度（YYYY-MM）の全drive並列取得 — 16-15 サイクル対応
export async function getDrivesForMonth(yearMonth) {
  const userId = getMyUserId();
  return fetchDrivesForUserMonth(userId, yearMonth);
}

// 内部: 1ユーザー × 1月度を sha 比較で最小コストに取得
async function fetchDrivesForUserMonth(userId, yearMonth) {
  const { start, end } = getBillingPeriodRange(yearMonth);
  let files;
  try {
    files = await listFiles(`data/drives/${userId}`);
  } catch (e) {
    return []; // listできない場合はスキップ
  }
  const periodFiles = files.filter(f => {
    if (!f.name.endsWith('.json')) return false;
    const date = f.name.replace('.json', '');
    return date >= start && date <= end;
  });
  const drives = await Promise.all(
    periodFiles.map(f => getFileBySha(f.path, f.sha).then(r => r?.content))
  );
  return drives.filter(d => d !== null);
}

// キャッシュからのみ復元（fetch しない）。初期表示用。
export function getDrivesForMonthCached(yearMonth) {
  const userId = getMyUserId();
  return getDrivesForUserMonthCached(userId, yearMonth);
}
function getDrivesForUserMonthCached(userId, yearMonth) {
  const { start, end } = getBillingPeriodRange(yearMonth);
  const files = getListCached(`data/drives/${userId}`);
  if (!files) return null; // キャッシュなし
  const drives = [];
  for (const f of files) {
    if (!f.name?.endsWith('.json')) continue;
    const date = f.name.replace('.json', '');
    if (date < start || date > end) continue;
    const cached = getFileCached(f.path);
    if (!cached) return null; // 一部欠け → 安全側で null（=「キャッシュ不完全」扱い）
    drives.push(cached.content);
  }
  return drives;
}

// UTF-8文字列を base64 エンコード
function encodeContent(jsonObject) {
  const text = JSON.stringify(jsonObject, null, 2);
  return btoa(unescape(encodeURIComponent(text)));
}

// ファイルを作成 or 更新（コンフリクト時は409返す）
export async function putFile(path, jsonObject, message, sha = null) {
  const repo = getRepo();
  const body = {
    message,
    content: encodeContent(jsonObject)
  };
  if (sha) body.sha = sha; // 更新時は必須

  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.status === 409 || (res.status === 422 && (await res.clone().json()).message?.includes('sha'))) {
    const err = new Error('Conflict');
    err.code = 'CONFLICT';
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function saveDrive(drive) {
  const userId = getMyUserId();
  const path = `data/drives/${userId}/${drive.date}.json`;
  // 既存shaを取得（更新の場合）
  const existing = await getFile(path);
  const sha = existing?.sha || null;
  const message = sha
    ? `update drive ${userId}/${drive.date}`
    : `add drive ${userId}/${drive.date}`;
  const result = await putFile(path, drive, message, sha);
  // キャッシュ即時更新: ファイル本体とディレクトリリスト
  setCached(`file:${path}`, drive, result?.content?.sha || null);
  delCached(`list:data/drives/${userId}`); // 次の listFiles で再取得
  return result;
}

export async function saveConfig(config) {
  const userId = getMyUserId();
  const path = `data/config/${userId}.json`;
  const existing = await getFile(path);
  const sha = existing?.sha || null;
  const result = await putFile(path, config, `update config ${userId}`, sha);
  setCached(`file:${path}`, config, result?.content?.sha || null);
  return result;
}

const PENDING_QUEUE_KEY = 'pending_saves';

function getPendingQueue() {
  return JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || '[]');
}

function setPendingQueue(queue) {
  localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
}

// saveDriveをラップ: 失敗時はキューに退避
export async function saveDriveSafe(drive) {
  try {
    return await saveDrive(drive);
  } catch (err) {
    if (err.code === 'CONFLICT') throw err; // コンフリクトは呼び元で処理
    // ネットワーク or その他失敗 → キューに退避
    const queue = getPendingQueue();
    queue.push({ type: 'drive', data: drive, queuedAt: Date.now() });
    setPendingQueue(queue);
    throw new Error(`保存失敗: ${err.message} (キューに退避済、復帰時に再送します)`);
  }
}

// 起動時に呼ぶ：キュー内の保存待ちを再送
export async function flushPendingQueue() {
  const queue = getPendingQueue();
  const remaining = [];
  for (const item of queue) {
    try {
      if (item.type === 'drive') await saveDrive(item.data);
    } catch (err) {
      remaining.push(item);
    }
  }
  setPendingQueue(remaining);
  return { sent: queue.length - remaining.length, remaining: remaining.length };
}

// data/users.json から active: true の userId 配列を取得
export async function listActiveUserIds() {
  const result = await getFile('data/users.json');
  if (!result?.content?.users) {
    // フォールバック: users.json が無い場合は自分のみ
    return [getMyUserId()];
  }
  return result.content.users
    .filter(u => u.active === true && isValidUserId(u.userId))
    .map(u => u.userId);
}

// data/users.json から active: true の {userId: displayName} マップを取得
export async function getUserDisplayMap() {
  const result = await getFile('data/users.json');
  const map = {};
  if (!result?.content?.users) return map;
  for (const u of result.content.users) {
    if (u.active === true && isValidUserId(u.userId)) {
      map[u.userId] = u.displayName || u.userId;
    }
  }
  return map;
}

// data/users.json から active: true の {userId: role} マップを取得
export async function getUserRoleMap() {
  const result = await getFile('data/users.json');
  const map = {};
  if (!result?.content?.users) return map;
  for (const u of result.content.users) {
    if (u.active === true && isValidUserId(u.userId)) {
      map[u.userId] = u.role || 'member';
    }
  }
  return map;
}

// 全 active userId の月度データを並列取得して flatten
export async function getAllUsersDrivesForMonth(yearMonth) {
  const userIds = await listActiveUserIds();
  const perUser = await Promise.all(userIds.map(async userId => {
    const drives = await fetchDrivesForUserMonth(userId, yearMonth);
    return drives.map(d => ({ ...d, _userId: userId }));
  }));
  return perUser.flat();
}

// users.json キャッシュから active userIds を導出
function getActiveUserIdsCached() {
  const cachedUsers = getFileCached('data/users.json');
  if (!cachedUsers?.content?.users) return null;
  return cachedUsers.content.users
    .filter(u => u.active === true && isValidUserId(u.userId))
    .map(u => u.userId);
}

// キャッシュからのみ復元（fetch しない）。1ユーザーでも欠けたら null
export function getAllUsersDrivesForMonthCached(yearMonth) {
  const userIds = getActiveUserIdsCached();
  if (!userIds) return null;
  const out = [];
  for (const userId of userIds) {
    const drives = getDrivesForUserMonthCached(userId, yearMonth);
    if (drives === null) return null;
    for (const d of drives) out.push({ ...d, _userId: userId });
  }
  return out;
}

// users.json キャッシュから displayMap/roleMap を即時導出
export function getUserDisplayMapCached() {
  const cached = getFileCached('data/users.json');
  if (!cached?.content?.users) return null;
  const map = {};
  for (const u of cached.content.users) {
    if (u.active === true && isValidUserId(u.userId)) {
      map[u.userId] = u.displayName || u.userId;
    }
  }
  return map;
}
export function getUserRoleMapCached() {
  const cached = getFileCached('data/users.json');
  if (!cached?.content?.users) return null;
  const map = {};
  for (const u of cached.content.users) {
    if (u.active === true && isValidUserId(u.userId)) {
      map[u.userId] = u.role || 'member';
    }
  }
  return map;
}
export function listActiveUserIdsCached() {
  return getActiveUserIdsCached();
}

// config キャッシュ
export function getConfigCached() {
  const userId = getMyUserId();
  const cached = getFileCached(`data/config/${userId}.json`);
  return cached?.content || null;
}

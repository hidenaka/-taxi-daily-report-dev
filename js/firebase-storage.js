// Firestore Storage - Replaces GitHub-based storage
import { db } from './firebase-init.js';
import { getUserId, waitForAuth, setUserId as fbSetUserId } from './firebase-auth.js';
import { DEFAULT_USER_ID, isValidUserId, normalizeUserId } from './userid.js';
import { getBillingPeriodRange } from './app.js';
import { DEFAULT_CONFIG } from './default-config.js';
import { 
  doc, getDoc, setDoc, deleteDoc, collection, 
  query, where, getDocs, orderBy, writeBatch,
  Timestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ========== DRIVES ==========

export async function getDrive(date) {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'drives', userId, 'daily', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

export async function saveDrive(date, data) {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'drives', userId, 'daily', date);
  await setDoc(ref, {
    ...data,
    updatedAt: new Date().toISOString()
  });
  return true;
}

// Admin専用: 任意ユーザーのデータを保存
export async function adminSaveDrive(targetUserId, date, data) {
  await waitForAuth();
  const ref = doc(db, 'drives', targetUserId, 'daily', date);
  await setDoc(ref, {
    ...data,
    updatedAt: new Date().toISOString()
  });
  return true;
}

// Admin専用: バッチ保存
export async function adminBatchSaveDrives(targetUserId, drives) {
  await waitForAuth();
  const batch = writeBatch(db);
  for (const drive of drives) {
    const ref = doc(db, 'drives', targetUserId, 'daily', drive.date);
    batch.set(ref, {
      ...drive,
      updatedAt: new Date().toISOString()
    });
  }
  await batch.commit();
  return true;
}

export async function deleteDrive(date) {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'drives', userId, 'daily', date);
  await deleteDoc(ref);
  return true;
}

export async function getDrivesForMonth(period) {
  await waitForAuth();
  const userId = getUserId();
  const { start, end } = getBillingPeriodRange(period);

  // orderBy を使わず範囲フィルタのみ（複合インデックス不要）
  const q = query(
    collection(db, 'drives', userId, 'daily'),
    where('date', '>=', start),
    where('date', '<=', end)
  );

  const snap = await getDocs(q);
  const drives = snap.docs.map(d => d.data());
  // クライアント側でソート
  drives.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return drives;
}

// Get all drives (for review/analysis)
export async function getAllDrives() {
  await waitForAuth();
  const userId = getUserId();
  const snap = await getDocs(collection(db, 'drives', userId, 'daily'));
  const drives = snap.docs.map(d => d.data());
  drives.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return drives;
}

// Get all drive dates (for navigation)
export async function getAllDriveDates() {
  await waitForAuth();
  const userId = getUserId();
  const snap = await getDocs(collection(db, 'drives', userId, 'daily'));
  const dates = snap.docs.map(d => d.id); // document ID is the date
  dates.sort();
  return dates;
}

// ========== CONFIG ==========

export async function getConfig() {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'userConfigs', userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // 初回: DEFAULT_CONFIG をコピーして保存
    const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    defaultConfig.payrollMode = 'step_rate';
    defaultConfig.fixedRate = 0.55;
    defaultConfig.privacy = { shareDataWithOthers: true };
    await setDoc(ref, defaultConfig);
    return defaultConfig;
  }
  return snap.data();
}

export async function saveConfig(config) {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'userConfigs', userId);
  await setDoc(ref, {
    ...config,
    updatedAt: new Date().toISOString()
  });
  return true;
}

// ========== BATCH OPERATIONS (for data migration) ==========

export async function batchSaveDrives(drives) {
  await waitForAuth();
  const userId = getUserId();
  const batch = writeBatch(db);
  
  for (const drive of drives) {
    const ref = doc(db, 'drives', userId, 'daily', drive.date);
    batch.set(ref, drive);
  }
  
  await batch.commit();
  return true;
}

// ========== PENDING QUEUE (for offline support) ==========

const PENDING_KEY = 'taxi_pending_queue';

export function queuePending(date, data) {
  const queue = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  queue.push({ date, data, timestamp: Date.now() });
  localStorage.setItem(PENDING_KEY, JSON.stringify(queue));
}

export async function flushPendingQueue() {
  const queue = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  if (queue.length === 0) return;
  
  await waitForAuth();
  const batch = writeBatch(db);
  const userId = getUserId();
  const processed = [];
  
  for (const item of queue) {
    try {
      const ref = doc(db, 'drives', userId, 'daily', item.date);
      batch.set(ref, item.data);
      processed.push(item);
    } catch (e) {
      console.error('Failed to queue item:', e);
    }
  }
  
  await batch.commit();
  
  // Remove processed items
  const remaining = queue.filter(q => !processed.includes(q));
  localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
}

// ========== CACHE (same interface as before) ==========

export function getConfigCached() {
  const cached = localStorage.getItem('taxi_config_cache');
  if (!cached) return null;
  try {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < 300000) return data; // 5 min cache
  } catch (e) {}
  return null;
}

export function cacheConfig(config) {
  localStorage.setItem('taxi_config_cache', JSON.stringify({
    data: config,
    timestamp: Date.now()
  }));
}

export function getDrivesForMonthCached(period) {
  const cached = localStorage.getItem(`taxi_drives_${period}`);
  if (!cached) return null;
  try {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < 300000) return data;
  } catch (e) {}
  return null;
}

export function cacheDrivesForMonth(period, drives) {
  localStorage.setItem(`taxi_drives_${period}`, JSON.stringify({
    data: drives,
    timestamp: Date.now()
  }));
}

// ========== COMPATIBILITY EXPORTS (match storage-github.js interface) ==========

const USER_ID_KEY = 'taxi_user_id';

export function getMyUserId() {
  // Prefer Firebase auth userId, fallback to localStorage
  const fbUid = getUserId();
  if (fbUid) return fbUid;
  const raw = localStorage.getItem(USER_ID_KEY);
  if (!raw) return DEFAULT_USER_ID;
  const norm = normalizeUserId(raw);
  return isValidUserId(norm) ? norm : DEFAULT_USER_ID;
}

export function setMyUserId(id) {
  const norm = normalizeUserId(id);
  if (!isValidUserId(norm)) {
    throw new Error('userId は英小文字始まりで英小文字・数字・アンダースコアのみ使用可');
  }
  localStorage.setItem(USER_ID_KEY, norm);
  // Also update Firebase if possible
  try { fbSetUserId(norm); } catch (e) {}
  return norm;
}

export function getRepo() {
  return 'firebase://taxi-dailydata';
}

// ========== COMPATIBILITY FUNCTIONS (migrated from GitHub API) ==========

export async function saveDriveSafe(drive) {
  try {
    return await saveDrive(drive.date, drive);
  } catch (err) {
    queuePending(drive.date, drive);
    throw new Error(`保存失敗: ${err.message} (キューに退避済、復帰時に再送します)`);
  }
}

// GitHub-style file listing: dir = 'data/drives' or 'data/drives/{userId}'
export async function listFiles(dir) {
  await waitForAuth();
  const userId = getUserId();
  if (dir === 'data/drives' || dir === `data/drives/${userId}`) {
    const dates = await getAllDriveDates();
    return dates.map(date => ({
      name: `${date}.json`,
      path: `data/drives/${userId}/${date}.json`,
      sha: null
    }));
  }
  return [];
}

// GitHub-style getFile: returns { content, sha } or null
export async function getFile(path) {
  await waitForAuth();
  const driveMatch = path.match(/^data\/drives\/([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (driveMatch) {
    const [, targetUserId, date] = driveMatch;
    const ref = doc(db, 'drives', targetUserId, 'daily', date);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { content: snap.data(), sha: null };
  }
  const configMatch = path.match(/^data\/config\/([^/]+)\.json$/);
  if (configMatch) {
    const [, targetUserId] = configMatch;
    const ref = doc(db, 'configs', targetUserId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { content: snap.data(), sha: null };
  }
  return null;
}

// GitHub-style putFile: returns { content: { sha } }
export async function putFile(path, jsonObject, message, sha = null) {
  await waitForAuth();
  const driveMatch = path.match(/^data\/drives\/([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (driveMatch) {
    const [, targetUserId, date] = driveMatch;
    const ref = doc(db, 'drives', targetUserId, 'daily', date);
    await setDoc(ref, {
      ...jsonObject,
      updatedAt: new Date().toISOString()
    });
    return { content: { sha: null } };
  }
  const configMatch = path.match(/^data\/config\/([^/]+)\.json$/);
  if (configMatch) {
    const [, targetUserId] = configMatch;
    const ref = doc(db, 'configs', targetUserId);
    await setDoc(ref, {
      ...jsonObject,
      updatedAt: new Date().toISOString()
    });
    return { content: { sha: null } };
  }
  throw new Error(`Unsupported path: ${path}`);
}

// ========== USER MANAGEMENT (for support / multi-user features) ==========

export async function listActiveUserIds() {
  await waitForAuth();
  try {
    const snap = await getDocs(collection(db, 'users'));
    const ids = snap.docs
      .map(d => d.data().userId)
      .filter(id => id && isValidUserId(id));
    // 同じuserIdが複数回登録されている場合がある（匿名認証の再ログインなど）
    const uniqueIds = [...new Set(ids)];
    
    // 実際にデータを持っているユーザーのみを返す（古い匿名ユーザーを除外）
    const activeIds = [];
    for (const uid of uniqueIds) {
      try {
        // drives/{userId}/daily コレクションに1件でもデータがあるか確認
        const drivesSnap = await getDocs(
          query(collection(db, 'drives', uid, 'daily'), limit(1))
        );
        if (!drivesSnap.empty) {
          activeIds.push(uid);
        }
      } catch (e) {
        // drivesコレクションにアクセスできない場合はスキップ
      }
    }
    
    // activeIdsが空の場合（データ取得に失敗した場合）はuniqueIdsを返す
    return activeIds.length > 0 ? activeIds : uniqueIds;
  } catch (e) {
    // 権限不足など: 自分のみ返す
    return [getUserId() || getMyUserId()];
  }
}

export async function getUserDisplayMap() {
  await waitForAuth();
  const map = {};
  try {
    const snap = await getDocs(collection(db, 'users'));
    for (const d of snap.docs) {
      const data = d.data();
      if (data.userId && isValidUserId(data.userId)) {
        map[data.userId] = data.displayName || data.userId;
      }
    }
  } catch (e) {
    // 権限不足: 自分のみ
    const myId = getUserId() || getMyUserId();
    map[myId] = myId;
  }
  return map;
}

export async function getUserRoleMap() {
  await waitForAuth();
  const map = {};
  try {
    const snap = await getDocs(collection(db, 'users'));
    for (const d of snap.docs) {
      const data = d.data();
      if (data.userId && isValidUserId(data.userId)) {
        map[data.userId] = data.role || 'member';
      }
    }
  } catch (e) {
    const myId = getUserId() || getMyUserId();
    map[myId] = 'member';
  }
  return map;
}

export async function getAllUsersDrivesForMonth(yearMonth) {
  await waitForAuth();
  const { start, end } = getBillingPeriodRange(yearMonth);
  let userIds;
  try {
    userIds = await listActiveUserIds();
  } catch (e) {
    userIds = [getUserId() || getMyUserId()];
  }
  const allDrives = [];
  for (const uid of userIds) {
    try {
      const q = query(
        collection(db, 'drives', uid, 'daily'),
        where('date', '>=', start),
        where('date', '<=', end)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        allDrives.push({ ...d.data(), _userId: uid });
      }
    } catch (e) {
      // skip user if permission denied
    }
  }
  allDrives.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return allDrives;
}

// ========== COMPANY TEMPLATES (for admin) ==========

export async function getCompanyTemplates() {
  await waitForAuth();
  const snap = await getDocs(collection(db, 'companyTemplates'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveCompanyTemplate(templateId, templateData) {
  await waitForAuth();
  const ref = doc(db, 'companyTemplates', templateId);
  await setDoc(ref, {
    ...templateData,
    updatedAt: new Date().toISOString()
  });
  return true;
}

// ========== CACHE COMPATIBILITY (no-op / fallback) ==========

export function getFileCached(path) { return null; }
export function getListCached(dir) { return null; }
export async function listFilesFresh(dir) { return listFiles(dir); }
export function getAllUsersDrivesForMonthCached(yearMonth) { return null; }
export function getUserDisplayMapCached() { return null; }
export function getUserRoleMapCached() { return null; }
export function listActiveUserIdsCached() { return null; }

// ========== ADMIN CLEANUP: Remove empty anonymous users ==========

export async function listAnonymousUsers() {
  await waitForAuth();
  const users = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    for (const d of snap.docs) {
      const data = d.data();
      if (data.isAnonymous && data.userId) {
        users.push({ uid: d.id, userId: data.userId });
      }
    }
  } catch (e) {
    console.error('listAnonymousUsers failed:', e);
  }
  return users;
}

export async function countUserDrives(userId) {
  await waitForAuth();
  try {
    const snap = await getDocs(collection(db, 'drives', userId, 'daily'));
    return snap.size;
  } catch (e) {
    return 0;
  }
}

export async function adminDeleteUserDoc(userId) {
  await waitForAuth();
  try {
    // Delete from users collection by querying userId
    const q = query(collection(db, 'users'), where('userId', '==', userId));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
    // Delete userConfig
    await deleteDoc(doc(db, 'userConfigs', userId));
    return true;
  } catch (e) {
    console.error('adminDeleteUserDoc failed:', e);
    return false;
  }
}

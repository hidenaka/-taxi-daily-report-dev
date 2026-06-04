// Firebase Auth - Anonymous + Email/Password authentication
import { auth, db } from './firebase-init.js';
import {
  signInAnonymously,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DEFAULT_CONFIG } from './default-config.js';
import { buildNewUserDoc } from './user-doc.js';
import { clearSubCache } from './sub-cache.js';
import { loadInviteSlug, loadReferrer } from './invite-url.js';

let currentUser = null;
let currentUserId = null;
let authInitPromise = null;

// ダミーメールドメイン
const DUMMY_EMAIL_DOMAIN = 'taxi.local';

function getDummyEmail(userId) {
  return `${userId}@${DUMMY_EMAIL_DOMAIN}`;
}

function getUserIdFromEmail(email) {
  if (!email || !email.endsWith(`@${DUMMY_EMAIL_DOMAIN}`)) return null;
  return email.split('@')[0];
}

// Default anonymous user ID (no random generation)
const DEFAULT_ANONYMOUS_USER_ID = 'user_sample';

// Initialize auth
export async function initAuth() {
  if (authInitPromise) return authInitPromise;

  authInitPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        // メール認証ユーザーの場合
        const emailUserId = getUserIdFromEmail(user.email);
        if (emailUserId) {
          currentUserId = emailUserId;
          // localStorageにも同期
          localStorage.setItem('taxi_user_id', emailUserId);
          unsubscribe();
          resolve(user);
          return;
        }
        
        // 匿名ユーザーの場合
        const localUserId = localStorage.getItem('taxi_user_id');
        const localValid = localUserId && /^[a-z][a-z0-9_]*$/.test(localUserId);

        if (localValid) {
          // 復帰ユーザーの通常ケース（コールドスタートの大半）: userId は localStorage で
          // 確定できる。認証をここで即解決し、users/{uid} の同期(書き込み)は描画を止めず
          // 裏で行う（案2）。以前は結果を使わない getDoc + setDoc の往復2回を resolve 前に
          // 待っており、それがホームのブランク時間になっていた。
          // users/{uid} は前回セッションで作成済みのため、裏書きでも Firestore ルール依存は無い。
          currentUserId = localUserId;
          unsubscribe();
          resolve(user);
          setDoc(doc(db, 'users', user.uid), {
            userId: localUserId,
            updatedAt: new Date().toISOString(),
            isAnonymous: true
          }, { merge: true }).catch(e => console.warn('user doc sync (bg) failed:', e));
          return;
        }

        // localStorage に有効な userId が無い（端末初回相当）→ userId 確定のため users/{uid} を読む。
        // この経路は users/{uid} 作成のルール依存があり得るため、従来どおり await する。
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const effectiveUserId = (userDoc.exists() ? userDoc.data().userId : null) || DEFAULT_ANONYMOUS_USER_ID;

          currentUserId = effectiveUserId;
          localStorage.setItem('taxi_user_id', effectiveUserId);

          await setDoc(doc(db, 'users', user.uid), {
            userId: effectiveUserId,
            updatedAt: new Date().toISOString(),
            isAnonymous: true
          }, { merge: true });

          unsubscribe();
          resolve(user);
        } catch (e) {
          unsubscribe();
          reject(e);
        }
      } else {
        // Not signed in, try anonymous (but don't generate random ID)
        try {
          const result = await signInAnonymously(auth);
          currentUser = result.user;
          
          const existingUserId = localStorage.getItem('taxi_user_id');
          currentUserId = (existingUserId && /^[a-z][a-z0-9_]*$/.test(existingUserId))
            ? existingUserId
            : DEFAULT_ANONYMOUS_USER_ID;
          
          localStorage.setItem('taxi_user_id', currentUserId);
          
          await setDoc(doc(db, 'users', currentUser.uid), {
            userId: currentUserId,
            createdAt: new Date().toISOString(),
            isAnonymous: true
          }, { merge: true });
          
          unsubscribe();
          resolve(currentUser);
        } catch (e) {
          unsubscribe();
          reject(e);
        }
      }
    });
  });

  return authInitPromise;
}

// メール認証でログイン
export async function loginWithUserId(userId, password) {
  const email = getDummyEmail(userId);
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    currentUser = result.user;
    currentUserId = userId;
    localStorage.setItem('taxi_user_id', userId);
    return { success: true, user: result.user };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 新規ユーザー作成（管理者用）
export async function createUserWithCredentials(userId, password) {
  const email = getDummyEmail(userId);
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    // users/{uid} を先に作成（myUserId() が機能するために必須）
    // これがないと Firestore Rules で userConfigs/{userId} への書き込みが拒否される
    await setDoc(doc(db, 'users', result.user.uid), buildNewUserDoc({
      userId,
      companyId: localStorage.getItem('taxi_pending_company') || null,
      referredBy: loadReferrer(localStorage),
    }));
    // userConfigsに初期設定を作成（DEFAULT_CONFIGをベースに）
    const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    await setDoc(doc(db, 'userConfigs', userId), defaultConfig);
    return { success: true, user: result.user };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// セルフサービス新規登録: ユーザーが選んだログインID＋パスワードで新規アカウントを作成する。
// 成功するとそのアカウントでログイン状態になる。匿名で使っていた場合、匿名セッションは
// 破棄される（匿名データ＝user_sample 等の共有デモは引き継がない＝まっさらな専用アカウント）。
//
// 完全招待制（decisions 6）: localStorage に有効な招待 slug (`taxi_pending_company`) が
// 無い場合は signup を拒否する。UI 側 (login.html) でも事前にガードしているが、ここでも
// 二重に防御（フォーム JS をバイパスして直接呼ばれるケース）。
export async function signUp(userId, password) {
  if (!loadInviteSlug(localStorage)) {
    return { success: false, error: '新規登録には招待URLが必要です。会社/組合から配布された招待URL経由でアクセスしてください。' };
  }
  if (!/^[a-z][a-z0-9_]*$/.test(userId)) {
    return { success: false, error: 'ログインIDは半角英小文字で始め、英小文字・数字・_ のみ使えます' };
  }
  if (userId.length < 3 || userId.length > 30) {
    return { success: false, error: 'ログインIDは3〜30文字にしてください' };
  }
  if (!password || password.length < 8) {
    return { success: false, error: 'パスワードは8文字以上にしてください' };
  }
  const result = await createUserWithCredentials(userId, password);
  if (!result.success) {
    let msg = result.error || '登録に失敗しました';
    if (/email-already-in-use/.test(msg)) {
      msg = 'このログインIDは既に使われています。別のIDをお試しください';
    } else if (/weak-password/.test(msg)) {
      msg = 'パスワードは8文字以上にしてください';
    }
    return { success: false, error: msg };
  }
  currentUser = result.user;
  currentUserId = userId;
  localStorage.setItem('taxi_user_id', userId);
  clearSubCache();
  return { success: true };
}

// ログアウト
export async function logout() {
  await signOut(auth);
  currentUser = null;
  currentUserId = null;
  authInitPromise = null;
  localStorage.removeItem('taxi_user_id');
  clearSubCache();
}

// Get current user ID
export function getUserId() {
  return currentUserId || localStorage.getItem('taxi_user_id');
}

// Set custom user ID
export async function setUserId(newId) {
  if (!currentUser) throw new Error('Not authenticated');
  if (!/^[a-z][a-z0-9_]*$/.test(newId)) throw new Error('Invalid user ID format');
  
  currentUserId = newId;
  await setDoc(doc(db, 'users', currentUser.uid), {
    userId: newId,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  localStorage.setItem('taxi_user_id', newId);
  clearSubCache(); // アカウント切替: 前ユーザーのサブスク状態を破棄
  return true;
}

// Check if user is authenticated
export function isAuthenticated() {
  return !!currentUser;
}

// Get current user object
export function getCurrentUser() {
  return currentUser;
}

// Check if email auth (not anonymous)
export function isEmailAuth() {
  return currentUser && !currentUser.isAnonymous;
}

// ============================================================
// アカウント活動記録 + 失効チェック（全画面共通フック）
// ============================================================

import { isAccountActive } from './access-control.js';

const ACTIVITY_LS_KEY = 'cabis_last_recorded_activity';

/** 1日1回だけ users/{uid}.lastActivityAt を更新。
 *  localStorage で 'YYYY-MM-DD' キーをチェックして重複書き込みを防ぐ。 */
export async function recordActivityThrottled(uid, _db = db) {
  if (!uid || !_db) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(ACTIVITY_LS_KEY) === todayKey) return;
  try {
    await updateDoc(doc(_db, 'users', uid), {
      lastActivityAt: serverTimestamp()
    });
    localStorage.setItem(ACTIVITY_LS_KEY, todayKey);
  } catch (e) {
    console.warn('[activity] recordActivityThrottled failed:', e.message);
  }
}

/** users/{uid} doc を取得して isAccountActive 判定、false なら signOut + アラート。
 *  戻り値: アカウントが有効か（true/false）。 */
export async function enforceAccountActive(uid, _db = db, _auth = auth) {
  if (!uid || !_db) return true;
  try {
    const snap = await getDoc(doc(_db, 'users', uid));
    const user = snap.exists() ? snap.data() : null;
    if (!isAccountActive(user)) {
      await _auth.signOut();
      alert('このアカウントは現在使えなくなっています。会社の管理者にお問い合わせください。');
      return false;
    }
  } catch (e) {
    console.warn('[account] enforceAccountActive failed:', e.message);
  }
  return true;
}

// 全画面共通の持続的 onAuthStateChanged フック（活動記録 + 失効チェック）
// initAuth() の一回限りリスナーとは別に、常時監視する。
onAuthStateChanged(auth, async (user) => {
  if (user && !user.isAnonymous) {
    // メール認証ユーザーのみ記録・チェック（匿名はスキップ）
    await recordActivityThrottled(user.uid);
    await enforceAccountActive(user.uid);
  }
});

// Wait for auth to be ready
export async function waitForAuth() {
  if (currentUser) return currentUser;
  return initAuth();
}

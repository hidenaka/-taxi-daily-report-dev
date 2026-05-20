// Firebase Auth - Anonymous + Email/Password authentication
import { auth, db } from './firebase-init.js';
import { 
  signInAnonymously, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DEFAULT_CONFIG } from './default-config.js';
import { buildNewUserDoc } from './user-doc.js';
import { clearSubCache } from './sub-cache.js';

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
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const localUserId = localStorage.getItem('taxi_user_id');
          
          // localStorageの有効なuserIdを優先（アカウント切り替え対応）
          const effectiveUserId = (localUserId && /^[a-z][a-z0-9_]*$/.test(localUserId))
            ? localUserId
            : (userDoc.exists() ? userDoc.data().userId : null) || DEFAULT_ANONYMOUS_USER_ID;
          
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
export async function signUp(userId, password) {
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

// Wait for auth to be ready
export async function waitForAuth() {
  if (currentUser) return currentUser;
  return initAuth();
}

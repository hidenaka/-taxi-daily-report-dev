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
import { clearDataCaches } from './drive-cache.js';
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
const USER_ID_RE = /^[a-z0-9][a-z0-9_]*$/;

// Initialize auth
export async function initAuth() {
  if (authInitPromise) return authInitPromise;

  authInitPromise = (async () => {
    // 永続セッション(IndexedDB)の復元完了を待つ。これを待たずに onAuthStateChanged の初回
    // null を「未ログイン」と誤認して signInAnonymously すると、復元中のメールセッションを
    // 匿名で上書きしてしまう（重複ユーザーdoc・ログイン消失・ログイン画面ループの真因）。
    // authStateReady 後の auth.currentUser が確定状態(復元済みユーザー or 本当に null)。
    try { await auth.authStateReady(); } catch (_) { /* 古いSDKでも安全に無視 */ }
    let user = auth.currentUser;

    // authStateReady 後でも null かつ「登録済みっぽい userId」が残っている場合のみ、復元が
    // 遅れている可能性があるので最大2sだけ onAuthStateChanged を猶予待ちする。
    //  - メールセッションの遅延復元 → ここで拾えるので匿名で上書き(クロバー)しない。
    //  - admin強制切替/通常ログアウト → 復元は来ないので猶予後に下の匿名サインインへ進む
    //    （= パスワード無しで対象 userId のデータを閲覧する「なりすまし」機能を維持）。
    if (!user) {
      const stored = localStorage.getItem('taxi_user_id');
      const looksRegistered = stored && USER_ID_RE.test(stored) && stored !== DEFAULT_ANONYMOUS_USER_ID;
      if (looksRegistered) {
        user = await new Promise((resolve) => {
          const off = onAuthStateChanged(auth, (u) => { if (u) { clearTimeout(t); off(); resolve(u); } });
          const t = setTimeout(() => { off(); resolve(auth.currentUser); }, 2000);
        });
      }
    }

    if (user) {
      currentUser = user;
      // メール認証ユーザーの場合
      const emailUserId = getUserIdFromEmail(user.email);
      if (emailUserId) {
        currentUserId = emailUserId;
        localStorage.setItem('taxi_user_id', emailUserId);
        return user;
      }
      // 匿名ユーザーの場合: localStorage の userId で確定。users/{uid} 同期は裏で。
      const localUserId = localStorage.getItem('taxi_user_id');
      if (localUserId && USER_ID_RE.test(localUserId)) {
        currentUserId = localUserId;
        // users/{uid}.userId は Firestore ルール isOwnerByUserId が drives/userConfigs 等の
        // アクセス可否判定に参照する。admin強制切替の閲覧でも必ず書かないとルールが読取を
        // 拒否するため、登録済み userId でも書く（isAnonymous:true で印付け）。重複(匿名docが
        // 登録userIdを持つ)はサーバー側が anon!==false を優先して吸収する(findCompanyIdByUserId)。
        setDoc(doc(db, 'users', user.uid), {
          userId: localUserId, updatedAt: new Date().toISOString(), isAnonymous: true,
        }, { merge: true }).catch((e) => console.warn('user doc sync (bg) failed:', e));
        return user;
      }
      // localStorage に有効な userId 無し（端末初回相当）→ users/{uid} を読んで確定。
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const effectiveUserId = (userDoc.exists() ? userDoc.data().userId : null) || DEFAULT_ANONYMOUS_USER_ID;
      currentUserId = effectiveUserId;
      localStorage.setItem('taxi_user_id', effectiveUserId);
      await setDoc(doc(db, 'users', user.uid), {
        userId: effectiveUserId, updatedAt: new Date().toISOString(), isAnonymous: true,
      }, { merge: true });
      return user;
    }

    // ここに来る＝authStateReady後もnull、猶予待ちでも復元されなかった＝本当に未ログイン。
    //  ・新規来訪 / ゲスト
    //  ・admin強制切替(ログアウト後 taxi_user_id=対象 を残して reload) → 対象のなりすまし閲覧
    //  ・通常ログアウト
    // いずれも匿名(ゲスト)サインインを作成し、localStorage の userId でデータを表示する。
    // 復元すべきメールセッションは上の if(user) 系で確定済みなので、ここでの匿名化で
    // メールアカウントを上書きすることはない（クロバーは authStateReady+猶予待ちで遮断済み）。
    const result = await signInAnonymously(auth);
    currentUser = result.user;
    const existingUserId = localStorage.getItem('taxi_user_id');
    currentUserId = (existingUserId && USER_ID_RE.test(existingUserId))
      ? existingUserId : DEFAULT_ANONYMOUS_USER_ID;
    localStorage.setItem('taxi_user_id', currentUserId);
    // users/{uid}.userId は Firestore ルールが drives/userConfigs 等のアクセス可否に参照するため、
    // admin強制切替の閲覧(匿名+対象userId)でも必ず書く。重複(匿名docが登録userIdを持つ)が
    // 生まれるが、それを前提に Worker findCompanyIdByUserId が anon!==false を優先して解決する。
    await setDoc(doc(db, 'users', result.user.uid), {
      userId: currentUserId, createdAt: new Date().toISOString(), isAnonymous: true,
    }, { merge: true });
    return result.user;
  })();

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
  if (!USER_ID_RE.test(userId)) {
    return { success: false, error: 'ログインIDは半角英小文字または数字で始め、英小文字・数字・_ のみ使えます' };
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
  // user を返す。login.html の登録ハンドラが r.user.getIdToken() で招待登録の
  // admin 通知(postSignupNotify)に使う。返さないと r.user が undefined になり
  // getIdToken() で例外→通知が静かにスキップされる（登録は成功するのにメールだけ
  // 来ない不具合の真因）。
  return { success: true, user: result.user };
}

// ログアウト
export async function logout() {
  await signOut(auth);
  currentUser = null;
  currentUserId = null;
  authInitPromise = null;
  localStorage.removeItem('taxi_user_id');
  clearViewAs();
  clearSubCache();
  // 端末に前ユーザーの日報/設定キャッシュを残さない（アカウント切替時のデータ漏れ/誤表示防止）。
  try { clearDataCaches(localStorage); } catch (e) { /* best-effort */ }
}

// ===== 管理者の「閲覧（view-as）」=====
// admin が他ユーザーのデータを閲覧/編集する仕組み。旧実装は「ログアウト→匿名→users doc の
// userId を対象に書き換え(なりすまし)」だったが、これは①userId重複doc を量産し②本人が書ける
// users.userId をアクセス権の根拠にする穴を使っていた。新実装は admin の認証を保ったまま
// taxi_view_as に対象 userId を置くだけ。データ読取は Firestore ルールの isAdmin() が許可する
// （= adminUids に uid がある人だけ実際に読める。非adminが set しても rules に弾かれるので無害）。
const VIEW_AS_KEY = 'taxi_view_as';

export function getViewAsUserId() {
  try {
    const v = localStorage.getItem(VIEW_AS_KEY);
    return (v && USER_ID_RE.test(v)) ? v : null;
  } catch (_) { return null; }
}

export function setViewAs(userId) {
  if (!USER_ID_RE.test(userId)) throw new Error('Invalid user ID format');
  localStorage.setItem(VIEW_AS_KEY, userId);
  clearSubCache();
  try { clearDataCaches(localStorage); } catch (_) { /* best-effort */ }
}

export function clearViewAs() {
  try { localStorage.removeItem(VIEW_AS_KEY); } catch (_) { /* noop */ }
  clearSubCache();
  try { clearDataCaches(localStorage); } catch (_) { /* best-effort */ }
}

// Get current user ID
// view-as 中は対象 userId を返す（全データ操作が対象ユーザーを向く）。それ以外は本人の userId。
// view-as は admin のなりすまし書込みを伴わない＝users doc は本人のまま。実アクセス可否は
// ルールの isAdmin() が担保する。
export function getUserId() {
  return getViewAsUserId() || currentUserId || localStorage.getItem('taxi_user_id');
}

// Set custom user ID
export async function setUserId(newId) {
  if (!currentUser) throw new Error('Not authenticated');
  if (!USER_ID_RE.test(newId)) throw new Error('Invalid user ID format');
  
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
// 復元待ち(authStateReady)と匿名フォールバックの判断は initAuth が一括で担う。
export async function waitForAuth() {
  if (currentUser) return currentUser;
  return initAuth();
}

// js/subscription-state.js — サブスクリプション状態管理
// 純関数(テスト対象) + Firestore アダプタ

// ============================================================
// 定数
// ============================================================

export const SUBSCRIPTION_STATUSES = [
  'pending',
  'trial',
  'active',
  'past_due',
  'canceled',
  'unpaid',
];

// 課金システム導入前から利用しているユーザー(grandfathered)。
// Firestoreに subscriptions ドキュメントが無くても active として扱う。
// 退会操作で実ドキュメントを作成すると、以後はそちらが優先される。
export const GRANDFATHERED_USERS = ['user_self', 'mm'];

export function isGrandfathered(userId) {
  return GRANDFATHERED_USERS.includes(userId);
}

export function buildGrandfatheredSubscription(userId) {
  return {
    status: 'active',
    planId: 'grandfathered_v1',
    agreedTermsAt: null,
    agreedTermsVersion: null,
    agreedPrivacyAt: null,
    agreedPrivacyVersion: null,
    agreedTokuteishouAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    canceledAt: null,
    cancelReason: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: null,
    updatedAt: null,
    grandfathered: true,
    _userId: userId,
  };
}

// ============================================================
// 純粋関数(テスト対象)
// ============================================================

export function isValidStatus(status) {
  return SUBSCRIPTION_STATUSES.includes(status);
}

export function isPaying(sub) {
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'trial';
}

export function isCanceledOrUnpaid(sub) {
  if (!sub) return false;
  return sub.status === 'canceled' || sub.status === 'unpaid';
}

export function requiresOnboarding(sub) {
  if (!sub) return true;
  return sub.status === 'pending';
}

// 同意フィールド一式を生成。nowIso は注入可能(テスト用)
export function computeAgreementSnapshot(versions, nowIso) {
  const now = nowIso || new Date().toISOString();
  return {
    agreedTermsAt: now,
    agreedTermsVersion: versions?.terms || null,
    agreedPrivacyAt: now,
    agreedPrivacyVersion: versions?.privacy || null,
    agreedTokuteishouAt: now,
  };
}

// ============================================================
// Firestore アダプタ(テスト対象外、各ページで使用)
// ============================================================

async function loadFirebase() {
  const [{ db }, auth, fs] = await Promise.all([
    import('./firebase-init.js'),
    import('./firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'),
  ]);
  await auth.waitForAuth();
  return { db, userId: auth.getUserId(), fs };
}

export async function getSubscription() {
  const { db, userId, fs } = await loadFirebase();
  const ref = fs.doc(db, 'subscriptions', userId);
  const snap = await fs.getDoc(ref);
  if (snap.exists()) return snap.data();
  if (isGrandfathered(userId)) return buildGrandfatheredSubscription(userId);
  return null;
}

export async function recordAgreementAndSubscribe(versions) {
  const { db, userId, fs } = await loadFirebase();
  const ref = fs.doc(db, 'subscriptions', userId);
  const existing = await fs.getDoc(ref);
  const now = new Date().toISOString();
  const agreement = computeAgreementSnapshot(versions, now);

  const payload = {
    ...(existing.exists() ? existing.data() : {}),
    ...agreement,
    status: 'pending',
    planId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    canceledAt: null,
    cancelReason: null,
    stripeCustomerId: existing.exists() ? (existing.data().stripeCustomerId || null) : null,
    stripeSubscriptionId: existing.exists() ? (existing.data().stripeSubscriptionId || null) : null,
    createdAt: existing.exists() ? (existing.data().createdAt || now) : now,
    updatedAt: now,
  };
  await fs.setDoc(ref, payload);
  return payload;
}

export async function cancelSubscription(reason) {
  const { db, userId, fs } = await loadFirebase();
  const ref = fs.doc(db, 'subscriptions', userId);
  const existing = await fs.getDoc(ref);
  const now = new Date().toISOString();
  let baseData;
  if (existing.exists()) {
    baseData = existing.data();
  } else if (isGrandfathered(userId)) {
    baseData = buildGrandfatheredSubscription(userId);
  } else {
    throw new Error('No subscription to cancel');
  }
  await fs.setDoc(ref, {
    ...baseData,
    status: 'canceled',
    canceledAt: now,
    cancelReason: reason || null,
    createdAt: baseData.createdAt || now,
    updatedAt: now,
  });
  return true;
}

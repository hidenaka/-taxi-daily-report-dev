// js/subscription-state.js — サブスクリプション状態管理
// 純関数(テスト対象) + Firestore アダプタ

import { writeSubCache, clearSubCache } from './sub-cache.js';

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

export const SUBSCRIPTION_STATUS_LABELS = {
  pending: '保留中(決済前)',
  trial: 'トライアル中',
  active: '有効',
  past_due: '支払い遅延',
  canceled: '退会済み',
  unpaid: '未払い',
};

// 表示用: "active(有効)" のように英語と日本語を併記
export function formatStatus(status) {
  const label = SUBSCRIPTION_STATUS_LABELS[status];
  if (!status) return '----';
  return label ? `${status}(${label})` : status;
}

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

// 管理者UIからの編集を既存ドキュメントとマージして書き込み用 payload を作る。
// updates: { status?, currentPeriodStart?, currentPeriodEnd?, planId?, cancelReason? }
// existing: 既存の subscription オブジェクト or null
// nowIso: 注入可能(テスト用)。書き込み時刻と canceledAt の判定に使う
export function adminBuildSubscriptionPayload(existing, updates, nowIso) {
  const now = nowIso || new Date().toISOString();
  const base = existing || {
    status: 'pending',
    planId: null,
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
    createdAt: now,
    updatedAt: now,
  };

  const next = { ...base };
  if (updates.status !== undefined && isValidStatus(updates.status)) next.status = updates.status;
  if (updates.planId !== undefined) next.planId = updates.planId || null;
  if (updates.currentPeriodStart !== undefined) next.currentPeriodStart = updates.currentPeriodStart || null;
  if (updates.currentPeriodEnd !== undefined) next.currentPeriodEnd = updates.currentPeriodEnd || null;
  if (updates.cancelReason !== undefined) next.cancelReason = updates.cancelReason || null;

  // canceled に遷移した時、canceledAt が未設定なら今で埋める
  if (next.status === 'canceled' && !next.canceledAt) {
    next.canceledAt = now;
  }
  // canceled 以外に遷移した時は canceledAt をクリア
  if (next.status !== 'canceled' && base.canceledAt) {
    next.canceledAt = null;
  }

  next.createdAt = base.createdAt || now;
  next.updatedAt = now;
  return next;
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
  let sub;
  if (snap.exists()) sub = snap.data();
  else if (isGrandfathered(userId)) sub = buildGrandfatheredSubscription(userId);
  else sub = null;
  // 次回のページ遷移で enforceAccess が Firebase に触れず即判定できるようキャッシュする
  writeSubCache(userId, sub);
  return sub;
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
  clearSubCache(); // 申込直後に古い状態を表示しないようキャッシュ破棄
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
  clearSubCache(); // 退会直後に古い状態を表示しないようキャッシュ破棄
  return true;
}

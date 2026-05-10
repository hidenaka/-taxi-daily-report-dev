// js/access-control.js — 課金状態に応じた機能アクセス制御(純関数)

export const FEATURES = ['core', 'analysis', 'export'];

export function isValidFeature(feature) {
  return FEATURES.includes(feature);
}

// canAccess: feature と subscription を受け取り、アクセス可否を返す
// sub: subscriptions/{userId} ドキュメントの値、または未申込時は null
export function canAccess(feature, sub) {
  if (!isValidFeature(feature)) return false;
  if (!sub) return false;

  switch (sub.status) {
    case 'trial':
    case 'active':
      return true;
    case 'past_due':
      // 支払い遅延: core は維持(閲覧/編集)、分析・エクスポートは制限
      return feature === 'core';
    case 'pending':
    case 'canceled':
    case 'unpaid':
    default:
      return false;
  }
}

// getRestrictionReason: UI 表示用の理由文言。アクセス可能なら null
export function getRestrictionReason(sub) {
  if (!sub) return 'お申し込みが必要です';
  switch (sub.status) {
    case 'pending':
      return 'お支払い手続きを完了してください';
    case 'past_due':
      return 'お支払いに問題があります。決済情報をご確認ください';
    case 'canceled':
      return '退会済みです';
    case 'unpaid':
      return '未払いのため利用できません';
    case 'trial':
    case 'active':
      return null;
    default:
      return 'ご利用いただけません';
  }
}

// ============================================================
// アダプタ(副作用あり、テスト対象外)
// ============================================================

// 各ページの先頭で呼ぶ。アクセス不可なら subscribe.html にリダイレクト。
// 戻り値: アクセス可なら true、リダイレクトした場合は false (このあとの処理は止めるべき)
export async function enforceAccess(feature, options = {}) {
  const redirectUrl = options.redirect || 'subscribe.html';
  const { getSubscription } = await import('./subscription-state.js');
  let sub = null;
  try {
    sub = await getSubscription();
  } catch (e) {
    console.error('enforceAccess: failed to load subscription', e);
    // 取得失敗時は安全側に倒してリダイレクト
    location.replace(redirectUrl);
    return false;
  }
  if (!canAccess(feature, sub)) {
    location.replace(redirectUrl);
    return false;
  }
  return true;
}

// js/access-control.js — 課金状態に応じた機能アクセス制御(純関数)

import { readSubCache, clearSubCache, isSubCacheFresh } from './sub-cache.js';

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

// 認証判定中、UIを操作できないようにする(visibility + pointer-events)。
// 判定がasyncなので、その間ユーザーが素早くタップして使えてしまうのを防ぐ。
function hideUntilCheck() {
  if (!document.body) return;
  document.body.style.visibility = 'hidden';
  document.body.style.pointerEvents = 'none';
}

function revealAfterCheck() {
  if (!document.body) return;
  // inline style で 'visible'/'auto' を強制設定。
  // 単に '' にすると <head> の <style>body{visibility:hidden}</style> が依然オーバーライドしてしまう。
  document.body.style.visibility = 'visible';
  document.body.style.pointerEvents = 'auto';
}

// localStorage から userId を読む（Firebase SDK をロードせずに取得するため）。
function readUserId() {
  try { return localStorage.getItem('taxi_user_id'); } catch { return null; }
}

// バックグラウンド再検証で失効を検出した時、現ページ上部に告知バナーを出す。
// 作業中の突然のリダイレクトを避け、次のページ遷移で確実に弾く（キャッシュは破棄済み）。
function showRevalidationBanner(redirectUrl) {
  if (!document.body || document.getElementById('access-revalidation-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'access-revalidation-banner';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
    + 'background:#c0392b;color:#fff;padding:10px 14px;font-size:13px;'
    + 'text-align:center;line-height:1.5;';
  bar.innerHTML = 'ご利用状態が変わりました。続行するにはお手続きが必要です　'
    + `<a href="${redirectUrl}" style="color:#fff;font-weight:bold;">お手続きへ</a>`;
  document.body.prepend(bar);
}

// 楽観表示の裏で最新のサブスク状態を取り直し、失効していれば是正する。
function revalidateInBackground(feature, redirectUrl) {
  import('./subscription-state.js')
    .then(({ getSubscription }) => getSubscription()) // 成功時にキャッシュも更新される
    .then((sub) => {
      if (!canAccess(feature, sub)) {
        clearSubCache(); // 次の遷移で確実にブロッキング検証＝リダイレクトされる
        showRevalidationBanner(redirectUrl);
      }
    })
    .catch((e) => {
      // 再検証失敗（オフライン等）はキャッシュ表示のまま据え置く（即追い出さない）
      console.warn('enforceAccess: background revalidation failed', e);
    });
}

// 各ページの先頭で呼ぶ。アクセス不可なら subscribe.html にリダイレクト。
// 戻り値: アクセス可なら true、リダイレクトした場合は false (このあとの処理は止めるべき)
//
// セッションキャッシュがあれば Firebase に触れず即座に表示し（楽観表示）、
// バックグラウンドで再検証する。ツール間の切り替えが高速になる。
export async function enforceAccess(feature, options = {}) {
  const redirectUrl = options.redirect || 'subscribe.html';
  hideUntilCheck();

  // --- セッションキャッシュ判定（ヒット時は Firebase をロードしない）---
  const cached = readSubCache();
  if (isSubCacheFresh(cached, Date.now()) && cached.userId === readUserId()) {
    if (canAccess(feature, cached.sub)) {
      revealAfterCheck();
      revalidateInBackground(feature, redirectUrl);
      return true;
    }
    location.replace(redirectUrl);
    return false;
  }

  // --- キャッシュミス（無し/期限切れ/userId不一致）: ブロッキング検証 ---
  const { getSubscription } = await import('./subscription-state.js');
  let sub = null;
  try {
    sub = await getSubscription(); // 内部でキャッシュも更新される
  } catch (e) {
    console.error('enforceAccess: failed to load subscription', e);
    // 取得失敗時は安全側に倒してリダイレクト(body は隠したまま)
    location.replace(redirectUrl);
    return false;
  }
  if (!canAccess(feature, sub)) {
    // 不可: 隠したままリダイレクト
    location.replace(redirectUrl);
    return false;
  }
  // 可: body を表示
  revealAfterCheck();
  return true;
}

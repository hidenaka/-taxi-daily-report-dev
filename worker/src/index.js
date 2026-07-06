// cabis-billing — Cloudflare Worker（キャビス課金バックエンド）
// ============================================================
// Stripe Checkout / Webhook / 解約 を処理し、Firestore の
// subscriptions/{userId} ドキュメントを最新状態に同期する。
//
// ルート:
//   GET  /health                   稼働確認
//   POST /create-checkout-session  { userId, couponCode? } -> { url }
//   POST /cancel-subscription      { userId, reason? }      -> { ok: true }
//   POST /webhook                  Stripe イベント受信
//   POST /verify-turnstile         { token, action? } -> { success } ログイン保護
//
// 環境変数（wrangler.toml [vars]）:
//   FIREBASE_PROJECT_ID, STRIPE_PRICE_ID, APP_BASE_URL, ALLOWED_ORIGIN
// シークレット（wrangler secret put）:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIREBASE_SERVICE_ACCOUNT,
//   TURNSTILE_SECRET_KEY（Cloudflare Turnstile siteverify 用）
//
// 依存パッケージなし（fetch + Web Crypto のみ）。
// ============================================================

import {
  handleIssueUrl, handleValidateToken, handleSubmit, handleArchive,
} from './setup-request/handler.js';
import { handleNotifySignup } from './signup-notify/handler.js';
import { makeFirestoreDeps } from './group-pool.js';
import { refreshGroupPool } from '../../js/group-pool-core.js';
import { verifyFirebaseIdToken } from './auth/verify-id-token.js';
import { makeMembershipDeps, createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug } from './group-membership.js';

// アプリ内 userId の形式（js/firebase-auth.js と一致させること）
const USER_ID_RE = /^[a-z0-9_]+$/;

// 初月無料の日数（特商法ドラフト・価格モデルで確定）
const TRIAL_DAYS = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      if (request.method === 'GET' && path === '/health') {
        return json(env, { ok: true, service: 'cabis-billing' });
      }
      if (request.method === 'POST' && path === '/create-checkout-session') {
        return await handleCreateCheckout(request, env);
      }
      if (request.method === 'POST' && path === '/start-free') {
        return await handleStartFree(request, env);
      }
      if (request.method === 'POST' && path === '/cancel-subscription') {
        return await handleCancel(request, env);
      }
      if (request.method === 'POST' && path === '/webhook') {
        return await handleWebhook(request, env);
      }
      if (request.method === 'POST' && path === '/verify-turnstile') {
        return await handleVerifyTurnstile(request, env);
      }
      if (request.method === 'POST' && path === '/setup-request/issue-url') {
        return await handleIssueUrl(request, env, helpersForSetupRequest(env));
      }
      if (request.method === 'GET' && path === '/setup-request/validate-token') {
        return await handleValidateToken(request, env, helpersForSetupRequest(env));
      }
      if (request.method === 'POST' && path === '/setup-request/submit') {
        return await handleSubmit(request, env, helpersForSetupRequest(env));
      }
      if (request.method === 'POST' && path === '/setup-request/archive') {
        return await handleArchive(request, env, helpersForSetupRequest(env));
      }
      if (request.method === 'POST' && path === '/notify-signup') {
        return await handleNotifySignup(request, env, {
          json: (obj, status = 200) => json(env, obj, status),
          findCompanyIdByUserId: async (userId) => {
            try {
              const token = await getAccessToken(env);
              return await findCompanyIdByUserId(env, token, userId);
            } catch {
              return null;
            }
          },
        });
      }
      if (request.method === 'POST' && path === '/group-create') {
        return await handleGroupCreate(request, env);
      }
      if (request.method === 'POST' && path === '/group-join') {
        return await handleGroupJoin(request, env);
      }
      if (request.method === 'POST' && path === '/group-leave') {
        return await handleGroupLeave(request, env);
      }
      if (request.method === 'POST' && path === '/group-pool-refresh') {
        return await handleGroupPoolRefresh(request, env);
      }
      return json(env, { error: 'not_found' }, 404);
    } catch (err) {
      console.error('worker error:', (err && err.stack) || err);
      return json(env, { error: 'internal' }, 500);
    }
  },
};

// ============================================================
// ルートハンドラ
// ============================================================

// 申込み: Stripe Checkout セッションを作成して URL を返す。
async function handleCreateCheckout(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const couponCode = String(body.couponCode || '').trim();
  const plan = String(body.plan || 'full').trim();
  const agreement = body.agreement || {};

  if (!USER_ID_RE.test(userId)) {
    return json(env, { error: 'invalid_user' }, 400);
  }

  // プランで価格を出し分け（simple=¥700 / full=¥1,000）。未知の値は full にフォールバック。
  const priceId = (plan === 'simple' && env.STRIPE_PRICE_ID_SIMPLE)
    ? env.STRIPE_PRICE_ID_SIMPLE
    : env.STRIPE_PRICE_ID;

  const params = {
    mode: 'subscription',
    locale: 'ja',
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { appUserId: userId },
    },
    metadata: { appUserId: userId },
    success_url: env.APP_BASE_URL + '/subscribe-success.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: env.APP_BASE_URL + '/subscribe-cancel.html',
  };

  // クーポンコード（プロモーションコード）が入力されていれば解決して割引適用。
  if (couponCode) {
    const lookup = await stripe(env, 'GET', '/promotion_codes?'
      + encodeForm({ code: couponCode, active: 'true', limit: 1 }));
    const promo = lookup.data && lookup.data[0];
    if (!promo) {
      return json(env, { error: 'invalid_coupon' }, 400);
    }
    params.discounts = [{ promotion_code: promo.id }];
  }

  // 同意記録 + status=pending を Firestore に書く。クライアントは firestore.rules
  // で subscriptions を書けないため、サーバー(Worker)が代行する。
  await recordAgreement(env, userId, agreement);

  const session = await stripe(env, 'POST', '/checkout/sessions', params);
  return json(env, { url: session.url });
}

// 申込時の同意記録と status=pending を subscriptions/{userId} に書き込む。
// updateMask 付き PATCH なので stripe* 等の既存フィールドは保持される。
async function recordAgreement(env, userId, agreement) {
  const token = await getAccessToken(env);
  const existing = await firestoreGet(env, token, 'subscriptions/' + userId);
  const createdAt = (existing && existing.fields && existing.fields.createdAt
    && existing.fields.createdAt.stringValue) || new Date().toISOString();
  const now = new Date().toISOString();
  await firestorePatch(env, token, 'subscriptions/' + userId, {
    status: 'pending',
    planId: null,
    agreedTermsAt: now,
    agreedTermsVersion: (agreement && agreement.termsVersion) || null,
    agreedPrivacyAt: now,
    agreedPrivacyVersion: (agreement && agreement.privacyVersion) || null,
    agreedTokuteishouAt: now,
    createdAt,
    updatedAt: now,
  });
}

// 無償会社の登録: users を userId で検索して本当の companyId を取得し、
// その会社の freeForInvited をサーバー検証してから active(無償) を付与する。
async function handleStartFree(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const agreement = body.agreement || {};
  if (!USER_ID_RE.test(userId)) return json(env, { error: 'invalid_user' }, 400);

  const token = await getAccessToken(env);
  const companyId = await findCompanyIdByUserId(env, token, userId);
  if (!companyId) return json(env, { error: 'no_company' }, 403);

  const company = await firestoreGet(env, token, 'companies/' + companyId);
  const free = company && company.fields && company.fields.freeForInvited
    && company.fields.freeForInvited.booleanValue === true;
  if (!free) return json(env, { error: 'not_free_company' }, 403);

  const existing = await firestoreGet(env, token, 'subscriptions/' + userId);
  const createdAt = (existing && existing.fields && existing.fields.createdAt
    && existing.fields.createdAt.stringValue) || new Date().toISOString();
  const now = new Date().toISOString();
  await firestorePatch(env, token, 'subscriptions/' + userId, {
    status: 'active',
    planId: 'comp_company',
    free: true,
    companyId,
    agreedTermsAt: now,
    agreedTermsVersion: (agreement && agreement.termsVersion) || null,
    agreedPrivacyAt: now,
    agreedPrivacyVersion: (agreement && agreement.privacyVersion) || null,
    agreedTokuteishouAt: now,
    createdAt,
    updatedAt: now,
  });
  // 個人課金中だった人の「無償への切替」: 既存Stripeサブスクを期間末で解約して課金停止。
  // 無償グラント(free:true)は上で記録済みなので、解約Webhookが届いても syncSubscription が保護する。
  const existingSubId = existing && existing.fields && existing.fields.stripeSubscriptionId
    && existing.fields.stripeSubscriptionId.stringValue;
  if (existingSubId) {
    try {
      await stripe(env, 'POST', '/subscriptions/' + existingSubId, {
        cancel_at_period_end: 'true',
        metadata: { appUserId: userId, cancelReason: 'switch_to_free_company' },
      });
    } catch (e) {
      console.error('start-free: 既存サブスクの解約に失敗（無償付与は成功）', existingSubId, (e && e.message) || e);
    }
  }
  return json(env, { ok: true });
}

// users コレクションを userId フィールドで検索し companyId を返す。
// 同じ userId の匿名stray doc が複数あるため、本登録(isAnonymous !== true)を優先する。
async function findCompanyIdByUserId(env, token, userId) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
    } }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return resolveCompanyIdFromUserQueryRows(rows);
}

export function resolveCompanyIdFromUserQueryRows(rows) {
  const docs = (Array.isArray(rows) ? rows : [])
    .map(r => r && r.document)
    .filter(Boolean);
  const registeredDocs = docs.filter((d) => {
    const f = d.fields || {};
    return !(f.isAnonymous && f.isAnonymous.booleanValue === true);
  });
  const candidates = registeredDocs.length > 0
    ? registeredDocs
    : (docs.length === 1 ? docs : []);
  if (candidates.length !== 1) return null;
  const f = candidates[0].fields || {};
  return (f.companyId && f.companyId.stringValue) || null;
}

// 退会: Stripe サブスクリプションを「期間末解約」に設定する。
// Firestore への反映は customer.subscription.updated Webhook で行う。
async function handleCancel(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const reason = String(body.reason || '').slice(0, 300);

  if (!USER_ID_RE.test(userId)) {
    return json(env, { error: 'invalid_user' }, 400);
  }

  // クライアント申告の subscriptionId は信用せず、Firestore から引く。
  const token = await getAccessToken(env);
  const doc = await firestoreGet(env, token, 'subscriptions/' + userId);
  const subId = doc && doc.fields && doc.fields.stripeSubscriptionId
    && doc.fields.stripeSubscriptionId.stringValue;
  if (!subId) {
    return json(env, { error: 'no_subscription' }, 404);
  }

  await stripe(env, 'POST', '/subscriptions/' + subId, {
    cancel_at_period_end: 'true',
    metadata: { appUserId: userId, cancelReason: reason },
  });
  return json(env, { ok: true });
}

// Stripe Webhook 受信。署名検証 → イベント別にサブスク状態を同期。
async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';

  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const type = event.type;
  const obj = (event.data && event.data.object) || {};

  try {
    if (type === 'checkout.session.completed') {
      const subId = obj.subscription;
      if (subId) {
        const sub = await stripe(env, 'GET', '/subscriptions/' + subId);
        await syncSubscription(env, sub, obj.client_reference_id);
      }
    } else if (type === 'customer.subscription.updated'
      || type === 'customer.subscription.deleted'
      || type === 'customer.subscription.created') {
      await syncSubscription(env, obj, null);
    } else if (type === 'invoice.payment_succeeded' || type === 'invoice.payment_failed') {
      const subId = obj.subscription
        || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (subId) {
        const sub = await stripe(env, 'GET', '/subscriptions/' + subId);
        await syncSubscription(env, sub, null);
      }
    }
    // それ以外のイベントは無視（200 で受領）
  } catch (err) {
    console.error('webhook handler error:', type, (err && err.stack) || err);
    // 500 を返すと Stripe が自動再送する
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================
// Cloudflare Turnstile siteverify（ログイン/新規登録フォームのBot対策）
// ============================================================

// クライアントから受け取った Turnstile token を Cloudflare に検証してもらう。
// ログイン・新規登録フォームのブルートフォース対策（割賦販売法セキュリティ
// 申告書「管理者画面のアカウントロック」相当を CAPTCHA 方式で満たす）。
async function handleVerifyTurnstile(request, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return json(env, { success: false, error: 'turnstile_not_configured' }, 500);
  }
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '');
  if (!token) {
    return json(env, { success: false, error: 'missing_token' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';

  const form = 'secret=' + encodeURIComponent(env.TURNSTILE_SECRET_KEY)
    + '&response=' + encodeURIComponent(token)
    + (ip ? '&remoteip=' + encodeURIComponent(ip) : '');

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return json(env, {
    success: !!data.success,
    errorCodes: data['error-codes'] || [],
  });
}

// ============================================================
// サブスクリプション状態の Firestore 同期
// ============================================================

// Stripe のサブスク status → アプリ内 status（access-control.js と一致）
const STATUS_MAP = {
  trialing: 'trial',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'unpaid',
  incomplete: 'pending',
  incomplete_expired: 'canceled',
  paused: 'past_due',
};

// Stripe サブスクオブジェクトから subscriptions/{userId} を更新する。
// updateMask 付き PATCH なので、同意情報など Worker が触らない項目は保持される。
async function syncSubscription(env, sub, clientRefUserId) {
  const userId = (sub.metadata && sub.metadata.appUserId) || clientRefUserId;
  if (!userId || !USER_ID_RE.test(userId)) {
    console.error('syncSubscription: appUserId が特定できない', sub.id);
    return;
  }

  const token = await getAccessToken(env);
  // 無償グラント保護: 既に free:true / planId=comp_company の人は、
  // （個人課金→無償切替後に届く）旧Stripeサブスクの解約Webhook等で上書きしない。
  const existingDoc = await firestoreGet(env, token, 'subscriptions/' + userId);
  const ef = (existingDoc && existingDoc.fields) || {};
  const isFreeGrant = (ef.free && ef.free.booleanValue === true)
    || (ef.planId && ef.planId.stringValue === 'comp_company');
  if (isFreeGrant) {
    console.log('syncSubscription: free grant, skip Stripe overwrite for', userId);
    return;
  }

  const status = STATUS_MAP[sub.status] || 'pending';
  const item = sub.items && sub.items.data && sub.items.data[0];
  // 購入された価格から tier（plan）を判定。simple価格なら 'simple'、それ以外は 'full'。
  const purchasedPriceId = item && item.price && item.price.id;
  const plan = (purchasedPriceId && env.STRIPE_PRICE_ID_SIMPLE
    && purchasedPriceId === env.STRIPE_PRICE_ID_SIMPLE) ? 'simple' : 'full';
  // current_period_* は API バージョンによりサブスク直下／item 配下のどちらか
  const periodStart = sub.current_period_start
    || (item && item.current_period_start) || null;
  const periodEnd = sub.current_period_end
    || (item && item.current_period_end) || null;

  const fields = {
    status,
    planId: 'paid_v1',
    plan,
    stripeCustomerId: typeof sub.customer === 'string'
      ? sub.customer
      : ((sub.customer && sub.customer.id) || null),
    stripeSubscriptionId: sub.id,
    currentPeriodStart: unixToIso(periodStart),
    currentPeriodEnd: unixToIso(periodEnd),
    trialEndsAt: unixToIso(sub.trial_end),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    updatedAt: new Date().toISOString(),
  };
  if (status === 'canceled') {
    fields.canceledAt = unixToIso(sub.canceled_at) || new Date().toISOString();
  }
  const reason = sub.metadata && sub.metadata.cancelReason;
  if (reason) fields.cancelReason = reason;

  await firestorePatch(env, token, 'subscriptions/' + userId, fields);
  console.log('synced subscriptions/' + userId, '->', status);
}

// ============================================================
// Stripe API（form-encoded、依存パッケージなし）
// ============================================================

async function stripe(env, method, path, params) {
  const opts = {
    method,
    headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      // API版を固定（アカウント既定の最新版はパラメータ仕様が変わりうるため）
      'Stripe-Version': '2024-06-20',
    },
  };
  if (params) opts.body = encodeForm(params);

  const res = await fetch('https://api.stripe.com/v1' + path, opts);
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('stripe ' + res.status);
    const e = new Error('Stripe API: ' + msg);
    e.stripeError = data && data.error;
    throw e;
  }
  return data;
}

// ネストしたオブジェクト／配列を Stripe 形式（a[b][c]=v, a[0][b]=v）に変換。
function encodeForm(obj, prefix) {
  const parts = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined || val === null) continue;
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (typeof val === 'object') {
      const nested = encodeForm(val, name);
      if (nested) parts.push(nested);
    } else {
      parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(val));
    }
  }
  return parts.join('&');
}

// Stripe-Signature ヘッダの HMAC-SHA256 検証（タイムスタンプ許容 5 分）。
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  let t = null;
  let v1 = null;
  for (const part of sigHeader.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1' && v1 === null) v1 = v;
  }
  if (!t || !v1) return false;

  const ts = parseInt(t, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(t + '.' + rawBody));
  const expected = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// Firestore REST API（サービスアカウント認証）
// ============================================================

function firestoreBase(env) {
  return 'https://firestore.googleapis.com/v1/projects/'
    + env.FIREBASE_PROJECT_ID + '/databases/(default)/documents';
}

async function firestoreGet(env, token, docPath) {
  const res = await fetch(firestoreBase(env) + '/' + docPath, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error('Firestore GET ' + res.status + ': ' + (await res.text()));
  }
  return res.json();
}

// updateMask 付き PATCH。指定したフィールドだけ更新（マージ）。
// ドキュメントが無ければ新規作成される。
async function firestorePatch(env, token, docPath, fields) {
  const mask = Object.keys(fields)
    .map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k))
    .join('&');
  const url = firestoreBase(env) + '/' + docPath + '?' + mask;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    throw new Error('Firestore PATCH ' + res.status + ': ' + (await res.text()));
  }
  return res.json();
}

function toFirestoreFields(obj) {
  const out = {};
  for (const key of Object.keys(obj)) {
    out[key] = toFirestoreValue(obj[key]);
  }
  return out;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

// ============================================================
// Google OAuth2（サービスアカウント JWT → アクセストークン）
// ============================================================

// アクセストークンは isolate 内でキャッシュ（有効期限まで再利用）。
let cachedToken = null; // { token, exp }

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) {
    return cachedToken.token;
  }

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const jwt = await createServiceAccountJwt(sa, now);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
      + '&assertion=' + encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('OAuth token: ' + JSON.stringify(data));
  }
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

async function createServiceAccountJwt(sa, now) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (o) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc(header) + '.' + enc(claim);

  const key = await importPrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key,
    new TextEncoder().encode(unsigned));
  return unsigned + '.' + base64url(new Uint8Array(sigBuf));
}

// サービスアカウント JSON の PEM 秘密鍵（PKCS#8）を CryptoKey に変換。
async function importPrivateKey(pem) {
  const der = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(der), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']);
}

// ============================================================
// 小物
// ============================================================

function unixToIso(sec) {
  return (typeof sec === 'number' && sec > 0)
    ? new Date(sec * 1000).toISOString()
    : null;
}

function base64url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(env, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// ============================================================
// /group-pool-refresh — オンデマンド匿名プール再構築
// ============================================================

// 呼び出し者の Firebase ID Token を検証し、groupId のメンバーであることを確認してから
// refreshGroupPool を実行する。書き込み先は groups/{groupId}/pool/current のみ。
async function handleGroupPoolRefresh(request, env) {
  const body = await request.json().catch(() => ({}));
  const groupId = body && body.groupId;
  if (!groupId || typeof groupId !== 'string') {
    return json(env, { error: 'groupId required' }, 400);
  }

  // 呼び出し者の本人確認: Firebase ID Token → uid
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!idToken) return json(env, { error: 'unauthorized' }, 401);

  let uid;
  try {
    const result = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    uid = result && result.uid;
  } catch {
    return json(env, { error: 'unauthorized' }, 401);
  }
  if (!uid) return json(env, { error: 'unauthorized' }, 401);

  const token = await getAccessToken(env);

  // uid → userId（users/{uid}.userId）
  const userDoc = await firestoreGet(env, token, 'users/' + uid);
  const myUserId = userDoc && userDoc.fields && userDoc.fields.userId
    && userDoc.fields.userId.stringValue;
  if (!myUserId) return json(env, { error: 'no-user' }, 403);

  const deps = makeFirestoreDeps({ env, token, firestoreGet, firestoreBase });

  // 呼び出し者がメンバーか確認（部外者の再構築要求を拒否）
  const group = await deps.readGroup(groupId);
  if (!group) return json(env, { error: 'no-group' }, 404);
  const members = Array.isArray(group.memberUserIds) ? group.memberUserIds : [];
  if (!members.includes(myUserId)) return json(env, { error: 'not-a-member' }, 403);

  const now = new Date();
  const result = await refreshGroupPool(deps, groupId, {
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
    ttlMs: 3600000,
    months: 6,
    maxItems: 5000,
    force: !!(body && body.force),
  });
  return json(env, { ok: true, ...result });
}

// ============================================================
// /group-create /group-join /group-leave — グループ作成/参加/退会（Worker仲介）
// ============================================================

// 共通: Authorization の ID Token から自分の userId を解決（無ければ null）。
// verifyFirebaseIdToken の戻りは { uid }（.uid を使う。.sub ではない）。
async function resolveMyUserId(request, env, token) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!idToken) return null;
  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID).catch(() => null);
  if (!claims || !claims.uid) return null;
  // uid → userId（users/{uid}.userId）。read のみ。
  const userDoc = await firestoreGet(env, token, 'users/' + claims.uid);
  return (userDoc && userDoc.fields && userDoc.fields.userId
    && userDoc.fields.userId.stringValue) || null;
}

async function handleGroupCreate(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestoreBase });
    const r = await createGroupOp(deps, {
      userId: myUserId,
      name: body && body.name,
      nowIso: new Date().toISOString(),
      requireContributionToView: !!(body && body.requireContributionToView),
      minViewContribution: body && body.minViewContribution,
      genSlug: () => newGroupSlug(),
    });
    return json(env, { ok: true, ...r });
  } catch (err) {
    console.error('group-create error:', (err && err.stack) || err);
    return json(env, { error: 'internal' }, 500);
  }
}

async function handleGroupJoin(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const slug = body && body.slug;
    if (!slug || typeof slug !== 'string') return json(env, { error: 'slug required' }, 400);
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestoreBase });
    const r = await joinGroupOp(deps, { userId: myUserId, slug, nowIso: new Date().toISOString() });
    const ok = r.status === 'joined' || r.status === 'already';
    const code = r.status === 'no-group' ? 404 : 200;
    return json(env, { ok, ...r }, code);
  } catch (err) {
    console.error('group-join error:', (err && err.stack) || err);
    return json(env, { error: 'internal' }, 500);
  }
}

async function handleGroupLeave(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const groupId = body && body.groupId;
    if (!groupId || typeof groupId !== 'string') return json(env, { error: 'groupId required' }, 400);
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestoreBase });
    // groupId=slug 運用なので findGroupBySlug で直接 GET（read のみ）。
    const found = await deps.findGroupBySlug(groupId);
    if (!found) return json(env, { error: 'no-group' }, 404);
    const r = await leaveGroupOp(deps, {
      userId: myUserId,
      groupId,
      nowIso: new Date().toISOString(),
      group: found.group,
    });
    const ok = r.status === 'left' || r.status === 'deleted';
    return json(env, { ok, ...r }, ok ? 200 : 403);
  } catch (err) {
    console.error('group-leave error:', (err && err.stack) || err);
    return json(env, { error: 'internal' }, 500);
  }
}

// ============================================================
// /setup-request/* 用ヘルパー注入（ハンドラを index.js から疎結合に保つ）
// ============================================================

function helpersForSetupRequest(env) {
  return {
    json: (obj, status = 200) => json(env, obj, status),
    getAccessToken: () => getAccessToken(env),
    generateUniqueSlug: async () => {
      const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
      const accessToken = await getAccessToken(env);
      for (let attempt = 0; attempt < 5; attempt++) {
        let s = 'co-';
        const buf = new Uint8Array(6);
        crypto.getRandomValues(buf);
        for (let i = 0; i < 6; i++) s += alphabet[buf[i] % alphabet.length];
        const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/companies/${s}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 404) return s;
      }
      throw new Error('slug 衝突回避失敗（5回試行）');
    },
  };
}

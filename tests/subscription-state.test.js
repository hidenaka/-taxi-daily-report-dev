import { test, assert } from './run.js';
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  GRANDFATHERED_USERS,
  isValidStatus,
  isPaying,
  isCanceledOrUnpaid,
  requiresOnboarding,
  computeAgreementSnapshot,
  isGrandfathered,
  buildGrandfatheredSubscription,
  adminBuildSubscriptionPayload,
  formatStatus,
} from '../js/subscription-state.js';

// --- isValidStatus ---
test('isValidStatus: 全ての有効ステータスを受け入れる', () => {
  for (const s of SUBSCRIPTION_STATUSES) {
    assert.equal(isValidStatus(s), true, `${s} should be valid`);
  }
});

test('isValidStatus: 無効値を拒否する', () => {
  assert.equal(isValidStatus('paid'), false);
  assert.equal(isValidStatus(''), false);
  assert.equal(isValidStatus(null), false);
  assert.equal(isValidStatus(undefined), false);
  assert.equal(isValidStatus('ACTIVE'), false);
});

// --- isPaying ---
test('isPaying: active と trial で true', () => {
  assert.equal(isPaying({ status: 'active' }), true);
  assert.equal(isPaying({ status: 'trial' }), true);
});

test('isPaying: 他の status で false', () => {
  assert.equal(isPaying({ status: 'pending' }), false);
  assert.equal(isPaying({ status: 'past_due' }), false);
  assert.equal(isPaying({ status: 'canceled' }), false);
  assert.equal(isPaying({ status: 'unpaid' }), false);
});

test('isPaying: null/undefined で false', () => {
  assert.equal(isPaying(null), false);
  assert.equal(isPaying(undefined), false);
});

// --- isCanceledOrUnpaid ---
test('isCanceledOrUnpaid: canceled と unpaid で true', () => {
  assert.equal(isCanceledOrUnpaid({ status: 'canceled' }), true);
  assert.equal(isCanceledOrUnpaid({ status: 'unpaid' }), true);
});

test('isCanceledOrUnpaid: 他の status で false', () => {
  assert.equal(isCanceledOrUnpaid({ status: 'pending' }), false);
  assert.equal(isCanceledOrUnpaid({ status: 'trial' }), false);
  assert.equal(isCanceledOrUnpaid({ status: 'active' }), false);
  assert.equal(isCanceledOrUnpaid({ status: 'past_due' }), false);
});

test('isCanceledOrUnpaid: null で false', () => {
  assert.equal(isCanceledOrUnpaid(null), false);
});

// --- requiresOnboarding ---
test('requiresOnboarding: null と pending で true', () => {
  assert.equal(requiresOnboarding(null), true);
  assert.equal(requiresOnboarding(undefined), true);
  assert.equal(requiresOnboarding({ status: 'pending' }), true);
});

test('requiresOnboarding: trial/active/past_due/canceled/unpaid で false', () => {
  assert.equal(requiresOnboarding({ status: 'trial' }), false);
  assert.equal(requiresOnboarding({ status: 'active' }), false);
  assert.equal(requiresOnboarding({ status: 'past_due' }), false);
  assert.equal(requiresOnboarding({ status: 'canceled' }), false);
  assert.equal(requiresOnboarding({ status: 'unpaid' }), false);
});

// --- computeAgreementSnapshot ---
test('computeAgreementSnapshot: versions と nowIso を反映', () => {
  const now = '2026-05-09T10:00:00.000Z';
  const out = computeAgreementSnapshot(
    { terms: '2026-05-08', privacy: '2026-05-08', tokuteishou: '2026-05-08' },
    now
  );
  assert.equal(out.agreedTermsAt, now);
  assert.equal(out.agreedPrivacyAt, now);
  assert.equal(out.agreedTokuteishouAt, now);
  assert.equal(out.agreedTermsVersion, '2026-05-08');
  assert.equal(out.agreedPrivacyVersion, '2026-05-08');
});

test('computeAgreementSnapshot: versions が欠けても null で埋まる', () => {
  const out = computeAgreementSnapshot({}, '2026-05-09T10:00:00.000Z');
  assert.equal(out.agreedTermsVersion, null);
  assert.equal(out.agreedPrivacyVersion, null);
});

test('computeAgreementSnapshot: versions が null でも例外を投げない', () => {
  const out = computeAgreementSnapshot(null, '2026-05-09T10:00:00.000Z');
  assert.equal(out.agreedTermsVersion, null);
  assert.equal(out.agreedPrivacyVersion, null);
});

test('computeAgreementSnapshot: nowIso 省略時に現在時刻が入る(ISO形式)', () => {
  const out = computeAgreementSnapshot({ terms: 'x', privacy: 'y' });
  assert.match(out.agreedTermsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// --- isGrandfathered ---
test('isGrandfathered: user_self と mm を受け入れる', () => {
  assert.equal(isGrandfathered('user_self'), true);
  assert.equal(isGrandfathered('mm'), true);
});

test('isGrandfathered: GRANDFATHERED_USERS に同一', () => {
  assert.deepEqual(GRANDFATHERED_USERS.slice().sort(), ['mm', 'user_self']);
});

test('isGrandfathered: 他の userId は false', () => {
  assert.equal(isGrandfathered('user_sample'), false);
  assert.equal(isGrandfathered('user_x'), false);
  assert.equal(isGrandfathered(''), false);
  assert.equal(isGrandfathered(null), false);
});

// --- buildGrandfatheredSubscription ---
test('buildGrandfatheredSubscription: status=active と grandfathered=true', () => {
  const sub = buildGrandfatheredSubscription('user_self');
  assert.equal(sub.status, 'active');
  assert.equal(sub.grandfathered, true);
  assert.equal(sub.planId, 'grandfathered_v1');
  assert.equal(sub._userId, 'user_self');
});

test('buildGrandfatheredSubscription: 純関数の他のヘルパで正しく扱える', () => {
  const sub = buildGrandfatheredSubscription('mm');
  assert.equal(isPaying(sub), true);
  assert.equal(requiresOnboarding(sub), false);
  assert.equal(isCanceledOrUnpaid(sub), false);
});

// --- adminBuildSubscriptionPayload ---
const NOW = '2026-05-10T10:00:00.000Z';

test('adminBuildSubscriptionPayload: existing=null で初期payload生成', () => {
  const out = adminBuildSubscriptionPayload(null, { status: 'active' }, NOW);
  assert.equal(out.status, 'active');
  assert.equal(out.createdAt, NOW);
  assert.equal(out.updatedAt, NOW);
  assert.equal(out.canceledAt, null);
});

test('adminBuildSubscriptionPayload: 既存をマージして上書き', () => {
  const existing = {
    status: 'pending', planId: 'old', currentPeriodStart: '2026-01-01',
    createdAt: '2026-04-01T00:00:00.000Z', canceledAt: null,
  };
  const out = adminBuildSubscriptionPayload(existing, { status: 'active', planId: 'monthly_v1' }, NOW);
  assert.equal(out.status, 'active');
  assert.equal(out.planId, 'monthly_v1');
  assert.equal(out.currentPeriodStart, '2026-01-01'); // 触らないものは保持
  assert.equal(out.createdAt, '2026-04-01T00:00:00.000Z'); // createdAt 不変
  assert.equal(out.updatedAt, NOW);
});

test('adminBuildSubscriptionPayload: status=canceled に遷移時、canceledAt が自動で入る', () => {
  const existing = { status: 'active', canceledAt: null, createdAt: '2026-04-01T00:00:00.000Z' };
  const out = adminBuildSubscriptionPayload(existing, { status: 'canceled' }, NOW);
  assert.equal(out.status, 'canceled');
  assert.equal(out.canceledAt, NOW);
});

test('adminBuildSubscriptionPayload: 既に canceledAt がある場合は上書きしない', () => {
  const existing = { status: 'canceled', canceledAt: '2026-01-15T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };
  const out = adminBuildSubscriptionPayload(existing, { cancelReason: 'admin' }, NOW);
  assert.equal(out.canceledAt, '2026-01-15T00:00:00.000Z');
  assert.equal(out.cancelReason, 'admin');
});

test('adminBuildSubscriptionPayload: canceled→active 復帰で canceledAt をクリア', () => {
  const existing = { status: 'canceled', canceledAt: '2026-01-15T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };
  const out = adminBuildSubscriptionPayload(existing, { status: 'active' }, NOW);
  assert.equal(out.status, 'active');
  assert.equal(out.canceledAt, null);
});

test('adminBuildSubscriptionPayload: 不正な status は無視する(既存維持)', () => {
  const existing = { status: 'active', createdAt: NOW };
  const out = adminBuildSubscriptionPayload(existing, { status: 'PAID' }, NOW);
  assert.equal(out.status, 'active');
});

test('adminBuildSubscriptionPayload: 開始日・終了日を空文字でクリアできる', () => {
  const existing = { status: 'active', currentPeriodStart: '2026-01-01', currentPeriodEnd: '2026-02-01', createdAt: NOW };
  const out = adminBuildSubscriptionPayload(existing, { currentPeriodStart: '', currentPeriodEnd: '' }, NOW);
  assert.equal(out.currentPeriodStart, null);
  assert.equal(out.currentPeriodEnd, null);
});

// --- formatStatus / SUBSCRIPTION_STATUS_LABELS ---
test('SUBSCRIPTION_STATUS_LABELS: 全 status に日本語ラベルがある', () => {
  for (const s of SUBSCRIPTION_STATUSES) {
    assert.ok(SUBSCRIPTION_STATUS_LABELS[s], `${s} should have a label`);
  }
});

test('formatStatus: 既知の status は "英語(日本語)" 形式', () => {
  assert.equal(formatStatus('active'), 'active(有効)');
  assert.equal(formatStatus('pending'), 'pending(保留中(決済前))');
  assert.equal(formatStatus('canceled'), 'canceled(退会済み)');
});

test('formatStatus: 不明な status はそのまま返す', () => {
  assert.equal(formatStatus('UNKNOWN'), 'UNKNOWN');
});

test('formatStatus: null/undefined/空文字は ---- を返す', () => {
  assert.equal(formatStatus(null), '----');
  assert.equal(formatStatus(undefined), '----');
  assert.equal(formatStatus(''), '----');
});

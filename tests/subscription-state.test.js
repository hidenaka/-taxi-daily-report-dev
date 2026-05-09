import { test, assert } from './run.js';
import {
  SUBSCRIPTION_STATUSES,
  isValidStatus,
  isPaying,
  isCanceledOrUnpaid,
  requiresOnboarding,
  computeAgreementSnapshot,
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

import { test, assert } from './run.js';
import {
  FEATURES,
  PLAN_TIERS,
  isValidFeature,
  canAccess,
  getRestrictionReason,
  getPlanTier,
  getAccessDenialReason,
  buildRedirectUrl,
} from '../js/access-control.js';

// --- isValidFeature ---
test('isValidFeature: 全 features を受け入れる', () => {
  for (const f of FEATURES) assert.equal(isValidFeature(f), true, `${f} should be valid`);
});

test('isValidFeature: 不明な feature を拒否', () => {
  assert.equal(isValidFeature('admin'), false);
  assert.equal(isValidFeature(''), false);
  assert.equal(isValidFeature(null), false);
});

// --- canAccess: status × feature 全パターン ---
const cases = [
  // [status, expectedByFeature]
  [null,                     { core: false, analysis: false, export: false }],
  [{ status: 'pending' },    { core: false, analysis: false, export: false }],
  [{ status: 'trial' },      { core: true,  analysis: true,  export: true  }],
  [{ status: 'active' },     { core: true,  analysis: true,  export: true  }],
  [{ status: 'past_due' },   { core: true,  analysis: false, export: false }],
  [{ status: 'canceled' },   { core: false, analysis: false, export: false }],
  [{ status: 'unpaid' },     { core: false, analysis: false, export: false }],
];

for (const [sub, expected] of cases) {
  const label = sub === null ? 'null' : sub.status;
  for (const feature of FEATURES) {
    test(`canAccess(${feature}, ${label}) = ${expected[feature]}`, () => {
      assert.equal(canAccess(feature, sub), expected[feature]);
    });
  }
}

test('canAccess: 不正な feature は常に false', () => {
  assert.equal(canAccess('unknown', { status: 'active' }), false);
  assert.equal(canAccess('', { status: 'active' }), false);
});

// --- getRestrictionReason ---
test('getRestrictionReason: null は申込促進', () => {
  assert.equal(getRestrictionReason(null), 'お申し込みが必要です');
});

test('getRestrictionReason: trial/active は null(理由なし)', () => {
  assert.equal(getRestrictionReason({ status: 'trial' }), null);
  assert.equal(getRestrictionReason({ status: 'active' }), null);
});

test('getRestrictionReason: pending/past_due/canceled/unpaid は文言を返す', () => {
  assert.ok(getRestrictionReason({ status: 'pending' }));
  assert.ok(getRestrictionReason({ status: 'past_due' }));
  assert.ok(getRestrictionReason({ status: 'canceled' }));
  assert.ok(getRestrictionReason({ status: 'unpaid' }));
});

// --- decisions 8: シンプル500円プラン ---

test('PLAN_TIERS: 期待される階層が含まれている', () => {
  assert.ok(PLAN_TIERS.includes('full'));
  assert.ok(PLAN_TIERS.includes('simple'));
});

test('getPlanTier: plan 未指定は full', () => {
  assert.equal(getPlanTier(null), 'full');
  assert.equal(getPlanTier({ status: 'active' }), 'full');
});

test('getPlanTier: 既知の値はそのまま返す', () => {
  assert.equal(getPlanTier({ status: 'active', plan: 'simple' }), 'simple');
  assert.equal(getPlanTier({ status: 'active', plan: 'full' }), 'full');
});

test('getPlanTier: 未知の値は full にフォールバック', () => {
  assert.equal(getPlanTier({ status: 'active', plan: 'premium' }), 'full');
});

test('canAccess: simple プラン active → core のみ true', () => {
  const sub = { status: 'active', plan: 'simple' };
  assert.equal(canAccess('core', sub), true);
  assert.equal(canAccess('analysis', sub), false);
  assert.equal(canAccess('export', sub), false);
});

test('canAccess: simple プラン trial → core のみ true', () => {
  const sub = { status: 'trial', plan: 'simple' };
  assert.equal(canAccess('core', sub), true);
  assert.equal(canAccess('analysis', sub), false);
});

test('canAccess: simple プラン past_due → core のみ true', () => {
  const sub = { status: 'past_due', plan: 'simple' };
  assert.equal(canAccess('core', sub), true);
  assert.equal(canAccess('analysis', sub), false);
});

test('canAccess: simple プラン canceled → 全部 false', () => {
  const sub = { status: 'canceled', plan: 'simple' };
  assert.equal(canAccess('core', sub), false);
  assert.equal(canAccess('analysis', sub), false);
});

test('canAccess: full プランは status=active で全部 true', () => {
  const sub = { status: 'active', plan: 'full' };
  assert.equal(canAccess('core', sub), true);
  assert.equal(canAccess('analysis', sub), true);
  assert.equal(canAccess('export', sub), true);
});

// --- getAccessDenialReason ---

test('getAccessDenialReason: 申込未/null → subscribe', () => {
  assert.equal(getAccessDenialReason('analysis', null), 'subscribe');
});

test('getAccessDenialReason: simple プランで analysis → simple-plan', () => {
  const sub = { status: 'active', plan: 'simple' };
  assert.equal(getAccessDenialReason('analysis', sub), 'simple-plan');
  assert.equal(getAccessDenialReason('export', sub), 'simple-plan');
});

test('getAccessDenialReason: simple プランで core (アクセス可) → null', () => {
  const sub = { status: 'active', plan: 'simple' };
  assert.equal(getAccessDenialReason('core', sub), null);
});

test('getAccessDenialReason: full アクセス可 → null', () => {
  const sub = { status: 'active', plan: 'full' };
  assert.equal(getAccessDenialReason('analysis', sub), null);
});

test('getAccessDenialReason: full status NG → restricted', () => {
  const sub = { status: 'past_due', plan: 'full' };
  assert.equal(getAccessDenialReason('analysis', sub), 'restricted');
});

// --- buildRedirectUrl ---

test('buildRedirectUrl: reason 無し → URL そのまま', () => {
  assert.equal(buildRedirectUrl('subscribe.html', null), 'subscribe.html');
  assert.equal(buildRedirectUrl('subscribe.html', 'subscribe'), 'subscribe.html');
});

test('buildRedirectUrl: reason 付き → クエリ追加', () => {
  assert.equal(buildRedirectUrl('subscribe.html', 'simple-plan'), 'subscribe.html?reason=simple-plan');
});

test('buildRedirectUrl: 既存クエリあり → & で連結', () => {
  assert.equal(buildRedirectUrl('subscribe.html?x=1', 'simple-plan'), 'subscribe.html?x=1&reason=simple-plan');
});

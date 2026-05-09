import { test, assert } from './run.js';
import {
  FEATURES,
  isValidFeature,
  canAccess,
  getRestrictionReason,
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

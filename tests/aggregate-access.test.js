import { test, assert } from './run.js';
import {
  ACCESS_LEVELS,
  getAccessLevel,
  getNextThreshold,
  getAccessLimits,
} from '../js/aggregate-access.js';

// ====== getAccessLevel ======
test('getAccessLevel: 0出番は onboarding', () => {
  assert.equal(getAccessLevel(0), 'onboarding');
});
test('getAccessLevel: 3出番は onboarding', () => {
  assert.equal(getAccessLevel(3), 'onboarding');
});
test('getAccessLevel: 4出番は light', () => {
  assert.equal(getAccessLevel(4), 'light');
});
test('getAccessLevel: 9出番は light', () => {
  assert.equal(getAccessLevel(9), 'light');
});
test('getAccessLevel: 10出番は standard', () => {
  assert.equal(getAccessLevel(10), 'standard');
});
test('getAccessLevel: 19出番は standard', () => {
  assert.equal(getAccessLevel(19), 'standard');
});
test('getAccessLevel: 20出番は full', () => {
  assert.equal(getAccessLevel(20), 'full');
});
test('getAccessLevel: 100出番は full', () => {
  assert.equal(getAccessLevel(100), 'full');
});
test('getAccessLevel: 負の値は onboarding', () => {
  assert.equal(getAccessLevel(-1), 'onboarding');
});

// ====== getNextThreshold ======
test('getNextThreshold: onboardingから next=light, 残4', () => {
  assert.deepEqual(getNextThreshold(0), { nextLevel: 'light', shiftsRemaining: 4 });
});
test('getNextThreshold: onboarding 3出番→残1', () => {
  assert.deepEqual(getNextThreshold(3), { nextLevel: 'light', shiftsRemaining: 1 });
});
test('getNextThreshold: light 4出番→standard 残6', () => {
  assert.deepEqual(getNextThreshold(4), { nextLevel: 'standard', shiftsRemaining: 6 });
});
test('getNextThreshold: standard 10出番→full 残10', () => {
  assert.deepEqual(getNextThreshold(10), { nextLevel: 'full', shiftsRemaining: 10 });
});
test('getNextThreshold: full は nextLevel=null', () => {
  assert.deepEqual(getNextThreshold(20), { nextLevel: null, shiftsRemaining: 0 });
});
test('getNextThreshold: full超過でも nextLevel=null', () => {
  assert.deepEqual(getNextThreshold(100), { nextLevel: null, shiftsRemaining: 0 });
});

// ====== getAccessLimits ======
test('getAccessLimits: onboarding 推奨検索のみ', () => {
  const limits = getAccessLimits(0);
  assert.equal(limits.recHistoryTop, 5);
  assert.equal(limits.areaTop, 0);
  assert.equal(limits.highValueTop, 0);
});
test('getAccessLimits: light で areaTop 解放', () => {
  const limits = getAccessLimits(4);
  assert.equal(limits.recHistoryTop, 15);
  assert.equal(limits.areaTop, 10);
  assert.equal(limits.highValueTop, 0);
});
test('getAccessLimits: standard で全カード閲覧可（件数制限あり）', () => {
  const limits = getAccessLimits(10);
  assert.equal(limits.recHistoryTop, 30);
  assert.equal(limits.areaTop, 15);
  assert.equal(limits.highValueTop, 10);
});
test('getAccessLimits: full は無制限（Infinity）', () => {
  const limits = getAccessLimits(20);
  assert.equal(limits.recHistoryTop, Infinity);
  assert.equal(limits.areaTop, Infinity);
  assert.equal(limits.highValueTop, Infinity);
});

// ====== ACCESS_LEVELS 定数 ======
test('ACCESS_LEVELS: 4段階すべて定義', () => {
  assert.ok(ACCESS_LEVELS.onboarding);
  assert.ok(ACCESS_LEVELS.light);
  assert.ok(ACCESS_LEVELS.standard);
  assert.ok(ACCESS_LEVELS.full);
});

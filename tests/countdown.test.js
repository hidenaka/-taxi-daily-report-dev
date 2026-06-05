import { test } from 'node:test';
import assert from 'node:assert';
import {
  computeRemainingMs,
  fmtCountdown,
  crossedZero,
  normalizeTimerState,
} from '../tools/js/countdown.js';

test('computeRemainingMs: 目標分 - 実経過ms', () => {
  assert.equal(computeRemainingMs(0, 27), 27 * 60 * 1000);
  assert.equal(computeRemainingMs(60 * 1000, 27), 26 * 60 * 1000);
  assert.equal(computeRemainingMs(30 * 60 * 1000, 27), -3 * 60 * 1000);
});

test('fmtCountdown: 残>=0 は MM:SS / 1時間以上は H:MM:SS', () => {
  assert.equal(fmtCountdown(27 * 60 * 1000), '27:00');
  assert.equal(fmtCountdown(5 * 1000), '00:05');
  assert.equal(fmtCountdown(0), '00:00');
  assert.equal(fmtCountdown(90 * 60 * 1000), '1:30:00');
});

test('fmtCountdown: 残<0 は「超過 +…」', () => {
  assert.equal(fmtCountdown(-3 * 60 * 1000 - 20 * 1000), '超過 +03:20');
  assert.equal(fmtCountdown(-1000), '超過 +00:01');
  assert.equal(fmtCountdown(-(90 * 60 * 1000)), '超過 +1:30:00');
});

test('crossedZero: 直前>0 かつ 今回<=0 の瞬間だけ true', () => {
  assert.equal(crossedZero(1000, -10), true);
  assert.equal(crossedZero(1000, 0), true);
  assert.equal(crossedZero(-10, -20), false);
  assert.equal(crossedZero(2000, 1000), false);
});

test('normalizeTimerState: 空入力は既定値（mode=up, target=27, sound=true, wakelock=false）', () => {
  const s = normalizeTimerState(null);
  assert.equal(s.mode, 'up');
  assert.equal(s.countdownTargetMin, 27);
  assert.equal(s.soundOn, true);
  assert.equal(s.wakeLockOn, false);
  assert.equal(s.targetBreakMin, 180);
  assert.equal(s.continuousDriveMin, 360);
  assert.equal(s.breakCountMin, 11);
});

test('normalizeTimerState: 旧データ（mode無し）は up 扱い、既存値は保持', () => {
  const s = normalizeTimerState({ records: [{ recordedAt: 'x', durationSec: 600 }], targetBreakMin: 120 });
  assert.equal(s.mode, 'up');
  assert.equal(s.countdownTargetMin, 27);
  assert.equal(s.targetBreakMin, 120);
  assert.equal(s.records.length, 1);
});

test('normalizeTimerState: 不正な countdownTargetMin は 27、soundOn=false は保持', () => {
  assert.equal(normalizeTimerState({ countdownTargetMin: 0 }).countdownTargetMin, 27);
  assert.equal(normalizeTimerState({ countdownTargetMin: -5 }).countdownTargetMin, 27);
  assert.equal(normalizeTimerState({ countdownTargetMin: 45 }).countdownTargetMin, 45);
  assert.equal(normalizeTimerState({ soundOn: false }).soundOn, false);
});

test('normalizeTimerState: Infinity/NaN は fallback 値にフォールバック', () => {
  assert.equal(normalizeTimerState({ countdownTargetMin: Infinity }).countdownTargetMin, 27);
});

import { test } from 'node:test';
import assert from 'node:assert';
import {
  computeRemainingMs,
  fmtCountdown,
  crossedZero,
  normalizeTimerState,
  fmtClockShort,
  overtimeNote,
  distanceMeters,
  normalizeCountdownPresets,
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

test('fmtClockShort: 経過msを MM:SS（1時間以上は H:MM:SS）。負は00:00', () => {
  assert.equal(fmtClockShort(0), '00:00');
  assert.equal(fmtClockShort(32 * 60 * 1000), '32:00');
  assert.equal(fmtClockShort(5 * 60 * 1000 + 3 * 1000), '05:03');
  assert.equal(fmtClockShort(60 * 60 * 1000 + 2 * 60 * 1000 + 5 * 1000), '1:02:05');
  assert.equal(fmtClockShort(-1000), '00:00');
});

test('overtimeNote: 超過<1分は「到達」、以降は「＋ 超過N分」（floor）', () => {
  assert.equal(overtimeNote(27 * 60 * 1000, 27), '目標27分 到達');           // 超過0
  assert.equal(overtimeNote(27 * 60 * 1000 + 30 * 1000, 27), '目標27分 到達'); // 超過30秒
  assert.equal(overtimeNote(27 * 60 * 1000 + 60 * 1000, 27), '目標27分 ＋ 超過1分');
  assert.equal(overtimeNote(32 * 60 * 1000, 27), '目標27分 ＋ 超過5分');
  assert.equal(overtimeNote(27 * 60 * 1000 + 5 * 60 * 1000 + 59 * 1000, 27), '目標27分 ＋ 超過5分'); // floor
});

test('overtimeNote: まだ目標未到達（超過<0）は空文字', () => {
  assert.equal(overtimeNote(10 * 60 * 1000, 27), '');
});

test('distanceMeters: 同一点は0', () => {
  assert.equal(distanceMeters({ lat: 35.6, lon: 139.7 }, { lat: 35.6, lon: 139.7 }), 0);
});

test('distanceMeters: 既知の距離（東京駅→品川駅 ≈ 6.8km、誤差5%以内）', () => {
  const tokyo = { lat: 35.681236, lon: 139.767125 };
  const shinagawa = { lat: 35.628471, lon: 139.738760 };
  const d = distanceMeters(tokyo, shinagawa);
  assert.ok(d > 6400 && d < 7200, `期待6.8km前後, 実測${Math.round(d)}m`);
});

test('distanceMeters: 緯度0.001度差 ≈ 111m（誤差2%以内）', () => {
  const d = distanceMeters({ lat: 35.0, lon: 139.0 }, { lat: 35.001, lon: 139.0 });
  assert.ok(d > 108 && d < 114, `期待~111m, 実測${Math.round(d)}m`);
});

test('distanceMeters: 対称性', () => {
  const a = { lat: 35.6, lon: 139.7 }, b = { lat: 35.65, lon: 139.75 };
  assert.equal(Math.round(distanceMeters(a, b)), Math.round(distanceMeters(b, a)));
});

test('normalizeTimerState: 新設定の既定値（alertDurationSec=5, moveDetectOn=true, moveThresholdM=500）', () => {
  const s = normalizeTimerState(null);
  assert.equal(s.alertDurationSec, 5);
  assert.equal(s.moveDetectOn, true);
  assert.equal(s.moveThresholdM, 500);
});

test('normalizeTimerState: alertDurationSecは>=0で保持、不正は5、0(止めるまで)も許容', () => {
  assert.equal(normalizeTimerState({ alertDurationSec: 10 }).alertDurationSec, 10);
  assert.equal(normalizeTimerState({ alertDurationSec: 0 }).alertDurationSec, 0);
  assert.equal(normalizeTimerState({ alertDurationSec: -3 }).alertDurationSec, 5);
  assert.equal(normalizeTimerState({ alertDurationSec: Infinity }).alertDurationSec, 5);
});

test('normalizeTimerState: moveThresholdMは>=100で保持、不正/小さすぎは500', () => {
  assert.equal(normalizeTimerState({ moveThresholdM: 300 }).moveThresholdM, 300);
  assert.equal(normalizeTimerState({ moveThresholdM: 50 }).moveThresholdM, 500);
  assert.equal(normalizeTimerState({ moveThresholdM: Infinity }).moveThresholdM, 500);
});

test('normalizeTimerState: moveDetectOnはboolean保持、無ければtrue', () => {
  assert.equal(normalizeTimerState({ moveDetectOn: false }).moveDetectOn, false);
  assert.equal(normalizeTimerState({}).moveDetectOn, true);
});

test('normalizeCountdownPresets: 既定は[11,15,27,30,45,60]', () => {
  assert.deepEqual(normalizeCountdownPresets(null), [11, 15, 27, 30, 45, 60]);
  assert.deepEqual(normalizeCountdownPresets(undefined), [11, 15, 27, 30, 45, 60]);
  assert.deepEqual(normalizeCountdownPresets('x'), [11, 15, 27, 30, 45, 60]);
});

test('normalizeCountdownPresets: 妥当な6個はそのまま（floor）', () => {
  assert.deepEqual(normalizeCountdownPresets([25, 40, 5, 60, 90, 120]), [25, 40, 5, 60, 90, 120]);
  assert.deepEqual(normalizeCountdownPresets([25.7, 40.2, 5, 60, 90, 120]), [25, 40, 5, 60, 90, 120]);
});

test('normalizeCountdownPresets: 不正な要素は同位置の既定にフォールバック', () => {
  assert.deepEqual(
    normalizeCountdownPresets([25, 'x', -3, Infinity, 0, 45]),
    [25, 15, 27, 30, 45, 45]
  );
});

test('normalizeCountdownPresets: 短い配列は不足分を既定で埋める / 上限600', () => {
  assert.deepEqual(normalizeCountdownPresets([20]), [20, 15, 27, 30, 45, 60]);
  assert.deepEqual(normalizeCountdownPresets([700, 15, 27, 30, 45, 60]), [11, 15, 27, 30, 45, 60]);
});

test('normalizeTimerState: countdownPresets を含む（既定6個）', () => {
  assert.deepEqual(normalizeTimerState(null).countdownPresets, [11, 15, 27, 30, 45, 60]);
  assert.deepEqual(normalizeTimerState({ countdownPresets: [25, 40, 5, 60, 90, 120] }).countdownPresets, [25, 40, 5, 60, 90, 120]);
});

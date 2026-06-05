// 乗務タイマー カウントダウン用の純粋ロジック（副作用なし）。
// ブラウザは tools/index.html から module import、テストは node --test から import する。

// 残りミリ秒 = 目標(分) - 実経過ミリ秒。負なら超過。
export function computeRemainingMs(elapsedMs, targetMin) {
  return targetMin * 60 * 1000 - elapsedMs;
}

// 残りミリ秒 → 表示文字列。
//   >= 0: "MM:SS"（1時間以上は "H:MM:SS"）
//   <  0: "超過 +MM:SS"（1時間以上は "超過 +H:MM:SS"）
export function fmtCountdown(remainingMs) {
  const over = remainingMs < 0;
  const totalSec = Math.floor(Math.abs(remainingMs) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const body = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return over ? `超過 +${body}` : body;
}

// 0クロス検出: 直前は残>0、今回は残<=0 になった瞬間だけ true。
export function crossedZero(prevRemainingMs, nowRemainingMs) {
  return prevRemainingMs > 0 && nowRemainingMs <= 0;
}

// localStorage から読んだ生オブジェクトを既定値で正規化（後方互換）。
export function normalizeTimerState(parsed) {
  const p = (parsed && typeof parsed === 'object') ? parsed : {};
  const numAtLeast = (v, min, fallback) =>
    (Number.isFinite(v) && v >= min) ? v : fallback;
  return {
    shiftStart: p.shiftStart || '07:00',
    records: Array.isArray(p.records) ? p.records : [],
    runningStartedAt: typeof p.runningStartedAt === 'number' ? p.runningStartedAt : null,
    targetBreakMin: numAtLeast(p.targetBreakMin, 0, 180),
    continuousDriveMin: (Number.isFinite(p.continuousDriveMin) && p.continuousDriveMin > 0) ? p.continuousDriveMin : 360,
    shiftStartAt: typeof p.shiftStartAt === 'number' ? p.shiftStartAt : null,
    lastResetSnapshot: (p.lastResetSnapshot && typeof p.lastResetSnapshot === 'object') ? p.lastResetSnapshot : null,
    breakCountMin: numAtLeast(p.breakCountMin, 0, 11),
    mode: p.mode === 'down' ? 'down' : 'up',
    countdownTargetMin: numAtLeast(p.countdownTargetMin, 1, 27),
    soundOn: typeof p.soundOn === 'boolean' ? p.soundOn : true,
    wakeLockOn: typeof p.wakeLockOn === 'boolean' ? p.wakeLockOn : false,
  };
}

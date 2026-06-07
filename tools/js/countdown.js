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

// 経過ミリ秒 → "MM:SS"（1時間以上は "H:MM:SS"）。負は 00:00。カウントダウン0到達後の合計表示用。
export function fmtClockShort(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 経過と目標(分)から注記文字列を返す。
//   超過<0: ''（未到達）
//   0<=超過<60秒: '目標{target}分 到達'
//   超過>=60秒: '目標{target}分 ＋ 超過{floor分}分'
export function overtimeNote(elapsedMs, targetMin) {
  const overtimeMs = elapsedMs - targetMin * 60 * 1000;
  if (overtimeMs < 0) return '';
  if (overtimeMs < 60 * 1000) return `目標${targetMin}分 到達`;
  return `目標${targetMin}分 ＋ 超過${Math.floor(overtimeMs / 60000)}分`;
}

// 2点間の直線距離(m)。ハバーサイン。引数 {lat, lon}（度）。移動検知用。
export function distanceMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000; // 地球半径(m)
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// カウントダウン目標プリセット(分)6個を正規化。各要素は1〜600の整数、
// 不正・不足は同じ位置の既定値で埋める。ユーザーが編集可能。
const DEFAULT_PRESETS = [11, 15, 27, 30, 45, 60];
export function normalizeCountdownPresets(arr) {
  const src = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < 6; i++) {
    const v = src[i];
    out.push((Number.isFinite(v) && v >= 1 && v <= 600) ? Math.floor(v) : DEFAULT_PRESETS[i]);
  }
  return out;
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
    // 通知音の長さ(秒)。0=止めるまで鳴り続ける。
    alertDurationSec: numAtLeast(p.alertDurationSec, 0, 5),
    // 移動検知ポップアップ
    moveDetectOn: typeof p.moveDetectOn === 'boolean' ? p.moveDetectOn : true,
    moveThresholdM: numAtLeast(p.moveThresholdM, 100, 500),
    // カウントダウン目標プリセット(分)6個。ユーザー編集可能。
    countdownPresets: normalizeCountdownPresets(p.countdownPresets),
  };
}

# カウントダウン休憩タイマー Phase1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の乗務タイマー（休憩カウントアップ）にカウントダウン表示モードを足し、0到達で前面通知（音はON/OFF選択可）し、画面常時点灯トグルも付ける。記録の中身（実経過時間）は変えない。

**Architecture:** カウントダウンは「残り＝目標−実経過」の表示変換＋0クロス通知だけ。内部ストップウォッチ（実経過）と既存の記録・休憩集計・連続走行可能時刻ロジックは無変更。純粋ロジックはテスト可能な ESM `tools/js/countdown.js` に切り出し、`tools/index.html` のメインスクリプトを module 化して import する。

**Tech Stack:** Vanilla JS（ESM）、localStorage、Web Audio API、`navigator.vibrate`、`navigator.wakeLock`、テストは `node --test`。

参照spec: `docs/superpowers/specs/2026-06-05-countdown-timer-design.md`

---

## File Structure

- **Create** `tools/js/countdown.js` — カウントダウンの純粋関数（`computeRemainingMs` / `fmtCountdown` / `crossedZero` / `normalizeTimerState`）。副作用なし。ブラウザと test の両方から import。
- **Create** `tests/countdown.test.js` — 上記純粋関数のユニットテスト。
- **Modify** `tools/index.html` — `.stopwatch` セクションにUI追加、メインスクリプトを module 化、state/loadState/saveState/render/notification/wakelock を実装。
- **Modify** `sw.js` — `CACHE_NAME` を `v274`→`v275` に bump、precache 配列に `./tools/js/countdown.js` を追加。

---

## Task 1: 純粋ロジック ESM `tools/js/countdown.js`（TDD）

**Files:**
- Create: `tools/js/countdown.js`
- Test: `tests/countdown.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/countdown.test.js`:

```js
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
  // 超過は負
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
});

test('crossedZero: 直前>0 かつ 今回<=0 の瞬間だけ true', () => {
  assert.equal(crossedZero(1000, -10), true);
  assert.equal(crossedZero(1000, 0), true);
  assert.equal(crossedZero(-10, -20), false); // すでに超過
  assert.equal(crossedZero(2000, 1000), false); // まだ残あり
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-countdown && node --test tests/countdown.test.js`
Expected: FAIL（`Cannot find module '../tools/js/countdown.js'`）

- [ ] **Step 3: 最小実装を書く**

Create `tools/js/countdown.js`:

```js
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
    (typeof v === 'number' && v >= min) ? v : fallback;
  return {
    shiftStart: p.shiftStart || '07:00',
    records: Array.isArray(p.records) ? p.records : [],
    runningStartedAt: typeof p.runningStartedAt === 'number' ? p.runningStartedAt : null,
    targetBreakMin: numAtLeast(p.targetBreakMin, 0, 180),
    continuousDriveMin: (typeof p.continuousDriveMin === 'number' && p.continuousDriveMin > 0) ? p.continuousDriveMin : 360,
    shiftStartAt: typeof p.shiftStartAt === 'number' ? p.shiftStartAt : null,
    lastResetSnapshot: (p.lastResetSnapshot && typeof p.lastResetSnapshot === 'object') ? p.lastResetSnapshot : null,
    breakCountMin: numAtLeast(p.breakCountMin, 0, 11),
    mode: p.mode === 'down' ? 'down' : 'up',
    countdownTargetMin: numAtLeast(p.countdownTargetMin, 1, 27),
    soundOn: typeof p.soundOn === 'boolean' ? p.soundOn : true,
    wakeLockOn: typeof p.wakeLockOn === 'boolean' ? p.wakeLockOn : false,
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd ~/work/taxi-countdown && node --test tests/countdown.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/js/countdown.js tests/countdown.test.js
git commit -m "feat(timer): カウントダウン純粋ロジックESM + テスト"
```

---

## Task 2: メインスクリプトを module 化し、新 state を配線

**Files:**
- Modify: `tools/index.html`（メイン `<script>` を module 化、`loadState`/`saveState`/`state` 初期化）

- [ ] **Step 1: メインスクリプト開始タグを module 化して import 追加**

`tools/index.html` の `.stopwatch` 等のロジックを含むメイン inline スクリプト（`// === Pure ===` で始まるブロック）の開始タグ `<script>` を以下に置換する（このスクリプトには inline onclick 依存が無いため module 化は安全）:

置換前:
```html
<script>
// ============================================================
// --- Pure ---
```

置換後:
```html
<script type="module">
import { computeRemainingMs, fmtCountdown, crossedZero, normalizeTimerState } from './js/countdown.js';
// ============================================================
// --- Pure ---
```

- [ ] **Step 2: `loadState` を normalizeTimerState 使用に置換**

置換前（`loadState` 関数全体）:
```js
function loadState() {
  const defaults = { shiftStart: '07:00', records: [], runningStartedAt: null, targetBreakMin: 180, continuousDriveMin: 360, shiftStartAt: null, lastResetSnapshot: null, breakCountMin: 11 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
      return {
        shiftStart: parsed.shiftStart || '07:00',
        records: Array.isArray(parsed.records) ? parsed.records : [],
        runningStartedAt: typeof parsed.runningStartedAt === 'number' ? parsed.runningStartedAt : null,
        targetBreakMin: (typeof parsed.targetBreakMin === 'number' && parsed.targetBreakMin >= 0) ? parsed.targetBreakMin : 180,
        continuousDriveMin: (typeof parsed.continuousDriveMin === 'number' && parsed.continuousDriveMin > 0) ? parsed.continuousDriveMin : 360,
        shiftStartAt: typeof parsed.shiftStartAt === 'number' ? parsed.shiftStartAt : null,
        lastResetSnapshot: (parsed.lastResetSnapshot && typeof parsed.lastResetSnapshot === 'object') ? parsed.lastResetSnapshot : null,
        breakCountMin: (typeof parsed.breakCountMin === 'number' && parsed.breakCountMin >= 0) ? parsed.breakCountMin : 11
      };
  } catch (e) {
    return defaults;
  }
}
```

置換後:
```js
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeTimerState(null);
    return normalizeTimerState(JSON.parse(raw));
  } catch (e) {
    return normalizeTimerState(null);
  }
}
```

- [ ] **Step 3: `saveState` に新フィールド書き出しを追加**

置換前（`saveState` 内のオブジェクト先頭部分）:
```js
  const data = {
    shiftStart: state.shiftStart,
    records: state.records,
    targetBreakMin: state.targetBreakMin,
    continuousDriveMin: state.continuousDriveMin,
    shiftStartAt: state.shiftStartAt,
    lastResetSnapshot: state.lastResetSnapshot,
    breakCountMin: state.breakCountMin
  };
```

置換後:
```js
  const data = {
    shiftStart: state.shiftStart,
    records: state.records,
    targetBreakMin: state.targetBreakMin,
    continuousDriveMin: state.continuousDriveMin,
    shiftStartAt: state.shiftStartAt,
    lastResetSnapshot: state.lastResetSnapshot,
    breakCountMin: state.breakCountMin,
    mode: state.mode,
    countdownTargetMin: state.countdownTargetMin,
    soundOn: state.soundOn,
    wakeLockOn: state.wakeLockOn
  };
```

- [ ] **Step 4: `state` 初期化に新フィールドを追加**

置換前:
```js
const _loaded = loadState();
const state = {
  shiftStart: _loaded.shiftStart,
  records: _loaded.records,
  targetBreakMin: _loaded.targetBreakMin,
  continuousDriveMin: _loaded.continuousDriveMin,
  shiftStartAt: _loaded.shiftStartAt,
  lastResetSnapshot: _loaded.lastResetSnapshot,
  breakCountMin: _loaded.breakCountMin,
  stopwatch: _loaded.runningStartedAt
    ? { running: true, startedAt: _loaded.runningStartedAt, elapsedMs: 0 }
    : { running: false, startedAt: null, elapsedMs: 0 }
};
```

置換後:
```js
const _loaded = loadState();
const state = {
  shiftStart: _loaded.shiftStart,
  records: _loaded.records,
  targetBreakMin: _loaded.targetBreakMin,
  continuousDriveMin: _loaded.continuousDriveMin,
  shiftStartAt: _loaded.shiftStartAt,
  lastResetSnapshot: _loaded.lastResetSnapshot,
  breakCountMin: _loaded.breakCountMin,
  mode: _loaded.mode,
  countdownTargetMin: _loaded.countdownTargetMin,
  soundOn: _loaded.soundOn,
  wakeLockOn: _loaded.wakeLockOn,
  stopwatch: _loaded.runningStartedAt
    ? { running: true, startedAt: _loaded.runningStartedAt, elapsedMs: 0 }
    : { running: false, startedAt: null, elapsedMs: 0 }
};

// カウントダウン0クロス検出用のランタイム状態（永続化しない）
let prevRemainingMs = null;          // 直前tickの残りms（null=未計測）
let countdownNotified = false;       // この走行で0通知済みか
// ロード時点で既に超過しているなら再読込で鳴らさない
if (state.mode === 'down' && state.stopwatch.running) {
  const _ms = state.stopwatch.elapsedMs + (Date.now() - state.stopwatch.startedAt);
  if (computeRemainingMs(_ms, state.countdownTargetMin) <= 0) countdownNotified = true;
}

// Wake Lock のスタブ（Task 6 で実体に差し替える）。
// これにより Task 4/5 で syncWakeLock() を呼んでも各コミットが動作する。
function syncWakeLock() {}
```

注: この `syncWakeLock` スタブは Task 6 Step 1 で本実装に置換する。

- [ ] **Step 5: 既存テスト全体が壊れていないか確認**

Run: `cd ~/work/taxi-countdown && node --test tests/*.test.js`
Expected: PASS（既存テスト＋countdown.test.js）。`tools/index.html` はブラウザ専用のためここでは構文影響なし。

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): メインスクリプトmodule化 + mode/target/sound/wakelock state配線"
```

---

## Task 3: UI 追加（モード切替・目標プリセット・トグル）

**Files:**
- Modify: `tools/index.html`（`.stopwatch` セクションのHTML、`<style>` のCSS）

- [ ] **Step 1: `.stopwatch` セクションにモード切替と目標行を追加**

置換前:
```html
    <section class="stopwatch">
      <div id="stopwatch-display">00:00:00</div>
      <div id="stopwatch-started" class="stopwatch-started"></div>
      <div id="provisional-break" class="provisional-break"></div>
      <div class="buttons">
        <button id="btn-start" type="button">スタート</button>
        <button id="btn-record" type="button" disabled>記録</button>
        <button id="btn-discard" type="button" disabled>破棄</button>
      </div>
    </section>
```

置換後:
```html
    <section class="stopwatch">
      <div class="mode-switch" role="tablist" aria-label="計測モード">
        <button id="mode-up" class="mode-btn active" type="button" role="tab" aria-selected="true">カウントアップ</button>
        <button id="mode-down" class="mode-btn" type="button" role="tab" aria-selected="false">カウントダウン</button>
      </div>

      <div id="countdown-panel" class="countdown-panel" hidden>
        <div class="cd-label">目標</div>
        <div class="cd-presets" id="cd-presets">
          <button class="cd-preset" type="button" data-min="11">11分</button>
          <button class="cd-preset" type="button" data-min="15">15分</button>
          <button class="cd-preset" type="button" data-min="27">27分</button>
          <button class="cd-preset" type="button" data-min="30">30分</button>
          <button class="cd-preset" type="button" data-min="45">45分</button>
          <button class="cd-preset" type="button" data-min="60">60分</button>
        </div>
        <div class="cd-custom hm-input">
          <input type="number" id="cd-hour" min="0" max="23" step="1" inputmode="numeric">
          <span>時間</span>
          <input type="number" id="cd-min" min="0" max="59" step="1" inputmode="numeric">
          <span>分</span>
        </div>
        <label class="cd-toggle"><input type="checkbox" id="cd-sound"> 0で音を鳴らす</label>
        <label class="cd-toggle"><input type="checkbox" id="cd-wakelock"> 休憩中は画面を消さない</label>
      </div>

      <div id="stopwatch-display">00:00:00</div>
      <div id="stopwatch-started" class="stopwatch-started"></div>
      <div id="provisional-break" class="provisional-break"></div>
      <div class="buttons">
        <button id="btn-start" type="button">スタート</button>
        <button id="btn-record" type="button" disabled>記録</button>
        <button id="btn-discard" type="button" disabled>破棄</button>
      </div>
    </section>
```

- [ ] **Step 2: CSS を追加**

`tools/index.html` の `<style>` ブロックの末尾（`</style>` の直前）に追加:

```css
.mode-switch { display: flex; gap: 6px; margin-bottom: 12px; }
.mode-btn {
  flex: 1; padding: 8px 6px; border: 1px solid var(--line, #d8d2bf);
  background: #fff; border-radius: 8px; font-size: 14px; cursor: pointer; color: #555;
}
.mode-btn.active { background: #1f6feb; color: #fff; border-color: #1f6feb; font-weight: 700; }
.countdown-panel {
  margin-bottom: 14px; padding: 12px; background: #f4f6fb;
  border: 1px solid #dbe2f0; border-radius: 10px; text-align: left;
}
.cd-label { font-size: 12px; color: #666; margin-bottom: 6px; }
.cd-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.cd-preset {
  padding: 6px 12px; border: 1px solid #cdd6ea; background: #fff;
  border-radius: 999px; font-size: 13px; cursor: pointer; color: #333;
}
.cd-preset.active { background: #1f6feb; color: #fff; border-color: #1f6feb; font-weight: 700; }
.cd-custom { margin-bottom: 10px; }
.cd-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; margin-top: 6px; cursor: pointer; }
#stopwatch-display.over { color: #c83a2c; }
@keyframes cd-flash { 0%,100% { background: transparent; } 50% { background: #f6dcd6; } }
.stopwatch.flash { animation: cd-flash 0.5s ease-in-out 3; border-radius: 12px; }
```

- [ ] **Step 3: ブラウザ表示確認（構文崩れチェック）**

Run: `cd ~/work/taxi-countdown && python3 -m http.server 8000` を起動し、別途確認（または executing 時に kimi-webbridge）。
Expected: ページが崩れず表示、「カウントアップ/カウントダウン」ボタンが見える（この時点では切替の挙動は未配線でよい）。

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): カウントダウンUI(モード切替/目標プリセット/音・画面トグル)追加"
```

---

## Task 4: レンダリングをモード対応にする

**Files:**
- Modify: `tools/index.html`（`renderStopwatch` / `renderButtons` / 新 `renderCountdownPanel` / `renderAll`）

- [ ] **Step 1: `renderStopwatch` をモード分岐に置換**

置換前:
```js
function renderStopwatch() {
  const ms = currentStopwatchMs();
  $('stopwatch-display').textContent = fmtStopwatch(ms / 1000);
  const startedEl = $('stopwatch-started');
  const provisionalEl = $('provisional-break');
  if (state.stopwatch.running && state.stopwatch.startedAt) {
    startedEl.textContent = `開始 ${fmtTime(new Date(state.stopwatch.startedAt))}`;
    const recordedMin = Math.floor(state.records.reduce((s, r) => s + r.durationSec, 0) / 60);
    const currentMin = Math.floor(ms / 60000);
    const provisionalMin = recordedMin + currentMin;
    provisionalEl.textContent = `暫定休憩 ${fmtMinutesSub(provisionalMin)}（記録済み ${fmtMinutesSub(recordedMin)} + 現在 ${fmtMinutesSub(currentMin)}）`;
  } else {
    startedEl.textContent = '';
    provisionalEl.textContent = '';
  }
}
```

置換後:
```js
function renderStopwatch() {
  const ms = currentStopwatchMs();
  const display = $('stopwatch-display');
  if (state.mode === 'down') {
    const remaining = computeRemainingMs(ms, state.countdownTargetMin);
    display.textContent = fmtCountdown(remaining);
    display.classList.toggle('over', remaining < 0);
  } else {
    display.textContent = fmtStopwatch(ms / 1000);
    display.classList.remove('over');
  }
  const startedEl = $('stopwatch-started');
  const provisionalEl = $('provisional-break');
  if (state.stopwatch.running && state.stopwatch.startedAt) {
    startedEl.textContent = `開始 ${fmtTime(new Date(state.stopwatch.startedAt))}`;
    const recordedMin = Math.floor(state.records.reduce((s, r) => s + r.durationSec, 0) / 60);
    const currentMin = Math.floor(ms / 60000);
    const provisionalMin = recordedMin + currentMin;
    provisionalEl.textContent = `暫定休憩 ${fmtMinutesSub(provisionalMin)}（記録済み ${fmtMinutesSub(recordedMin)} + 現在 ${fmtMinutesSub(currentMin)}）`;
  } else {
    startedEl.textContent = '';
    provisionalEl.textContent = '';
  }
}
```

- [ ] **Step 2: モードパネル描画関数を追加**

`renderStopwatch` の直後に新関数を追加:

```js
function renderCountdownPanel() {
  // モードボタンの選択状態
  const down = state.mode === 'down';
  $('mode-up').classList.toggle('active', !down);
  $('mode-down').classList.toggle('active', down);
  $('mode-up').setAttribute('aria-selected', String(!down));
  $('mode-down').setAttribute('aria-selected', String(down));
  // パネル表示
  $('countdown-panel').hidden = !down;
  // プリセットの選択ハイライト
  document.querySelectorAll('.cd-preset').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.min) === state.countdownTargetMin);
  });
  // 自由入力（フォーカス中は上書きしない）
  const hourEl = $('cd-hour'), minEl = $('cd-min');
  if (document.activeElement !== hourEl && document.activeElement !== minEl) {
    const m = Math.max(0, Math.floor(state.countdownTargetMin));
    hourEl.value = Math.floor(m / 60);
    minEl.value = m % 60;
  }
  // トグル
  $('cd-sound').checked = state.soundOn;
  $('cd-wakelock').checked = state.wakeLockOn;
}
```

- [ ] **Step 3: `renderAll` に `renderCountdownPanel` を追加**

置換前:
```js
function renderAll() {
  renderDate();
  renderShiftStart();
  renderTargetBreak();
  renderContinuousDrive();
  renderBreakCount();
  renderStopwatch();
  renderButtons();
  renderMetrics();
  renderHistory();
  renderUndoReset();
}
```

置換後:
```js
function renderAll() {
  renderDate();
  renderShiftStart();
  renderTargetBreak();
  renderContinuousDrive();
  renderBreakCount();
  renderCountdownPanel();
  renderStopwatch();
  renderButtons();
  renderMetrics();
  renderHistory();
  renderUndoReset();
}
```

- [ ] **Step 4: モード切替・プリセット・自由入力・トグルのイベントを追加**

`$('btn-settings-toggle')` のイベント登録の直前（`// --- Events ---` セクション内の任意の箇所）に追加:

```js
// --- カウントダウン: モード・目標・トグル ---
function setMode(mode) {
  state.mode = mode === 'down' ? 'down' : 'up';
  prevRemainingMs = null;            // モード切替で0クロス追跡をリセット
  saveState(state);
  renderAll();
}
$('mode-up').addEventListener('click', () => setMode('up'));
$('mode-down').addEventListener('click', () => setMode('down'));

function setCountdownTarget(min) {
  const v = Math.max(1, Math.floor(min));
  state.countdownTargetMin = v;
  prevRemainingMs = null;            // 目標変更で0クロス追跡をリセット
  countdownNotified = false;         // 目標を変えたら通知を再武装
  saveState(state);
  renderAll();
}
document.querySelectorAll('.cd-preset').forEach(b => {
  b.addEventListener('click', () => setCountdownTarget(Number(b.dataset.min)));
});
function onCdCustomChange() {
  const total = readHMInput('cd-hour', 'cd-min');
  setCountdownTarget(total > 0 ? total : 1);
}
$('cd-hour').addEventListener('change', onCdCustomChange);
$('cd-min').addEventListener('change', onCdCustomChange);

$('cd-sound').addEventListener('change', (e) => {
  state.soundOn = !!e.target.checked;
  saveState(state);
});
$('cd-wakelock').addEventListener('change', (e) => {
  state.wakeLockOn = !!e.target.checked;
  saveState(state);
  syncWakeLock();                    // Task 6 で定義
});
```

注: `readHMInput` は既存の汎用関数（`tools/index.html` に定義済み）を再利用する。`syncWakeLock` は Task 6 で定義する（この時点では未定義参照になるため、Task 6 まで `cd-wakelock` の change は実行時エラーになりうる。Task 6 を続けて実装すること）。

- [ ] **Step 5: 実機/ブラウザで確認（executing 時）**

Expected: 「カウントダウン」を押すとパネルが出て、27分プリセットを押すと表示が `27:00` になる。スタートで残りが減る。アップ↔ダウン切替で内部経過は保たれる。

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): モード対応レンダリング + 目標/トグルのイベント配線"
```

---

## Task 5: 0クロス通知（音[ON/OFF]・バイブ・赤フラッシュ）

**Files:**
- Modify: `tools/index.html`（通知ヘルパー、`btn-start` でAudio解除、tick で0クロス検出）

- [ ] **Step 1: 通知ヘルパーを追加**

`// --- Tick ---` セクションの直前（`const RESET_UNDO_TTL_MS` 付近の Events 末尾でよい）に追加:

```js
// --- 0クロス通知 ---
let audioCtx = null;
function ensureAudio() {
  // iOS の自動再生制限解除のため、ユーザー操作(スタート)時に生成/resume する
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* 非対応環境は無視 */ }
}
function beep() {
  if (!state.soundOn || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [0, 0.25].forEach((offset) => {           // 短音×2
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now + offset); osc.stop(now + offset + 0.2);
    });
  } catch (e) { /* 無視 */ }
}
function fireZeroNotification() {
  beep();                                       // soundOn のときだけ鳴る
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  const sw = document.querySelector('.stopwatch');
  if (sw) { sw.classList.remove('flash'); void sw.offsetWidth; sw.classList.add('flash'); }
}
```

- [ ] **Step 2: `btn-start` で Audio を解除＆通知を再武装**

置換前:
```js
$('btn-start').addEventListener('click', () => {
  state.stopwatch.running = true;
  state.stopwatch.startedAt = Date.now();
  state.stopwatch.elapsedMs = 0;
  saveState(state);
  renderAll();
});
```

置換後:
```js
$('btn-start').addEventListener('click', () => {
  ensureAudio();                    // iOS 音解除（ユーザー操作内で）
  state.stopwatch.running = true;
  state.stopwatch.startedAt = Date.now();
  state.stopwatch.elapsedMs = 0;
  prevRemainingMs = null;           // 0クロス追跡リセット
  countdownNotified = false;        // 通知を再武装
  saveState(state);
  syncWakeLock();                   // 走行開始でWake Lock反映（Task 6）
  renderAll();
});
```

- [ ] **Step 3: tick に0クロス検出を追加**

置換前:
```js
  renderStopwatch();
  renderMetrics();
  renderButtons();
}, 1000);
```

置換後:
```js
  // カウントダウンの0クロス検出（前面表示中のみ動作）
  if (state.mode === 'down' && state.stopwatch.running) {
    const remaining = computeRemainingMs(currentStopwatchMs(), state.countdownTargetMin);
    if (!countdownNotified && prevRemainingMs !== null && crossedZero(prevRemainingMs, remaining)) {
      countdownNotified = true;
      fireZeroNotification();
    }
    prevRemainingMs = remaining;
  } else {
    prevRemainingMs = null;
  }
  renderStopwatch();
  renderMetrics();
  renderButtons();
}, 1000);
```

- [ ] **Step 4: 実機/ブラウザで確認（executing 時）**

Expected: カウントダウンで短い目標（例: 自由入力で0時間1分）を設定→スタート→約60秒後に音（soundON時）＋赤フラッシュ＋以後 `超過 +…`。soundOFFなら音は鳴らずフラッシュのみ。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): 0クロス通知(音ON/OFF・バイブ・赤フラッシュ)"
```

---

## Task 6: Wake Lock（画面を消さない）

**Files:**
- Modify: `tools/index.html`（`syncWakeLock` 定義、`visibilitychange`、記録/破棄/リセットで解放）

- [ ] **Step 1: スタブ `syncWakeLock` を本実装に置換**

Task 2 Step 4 で置いたスタブ:
```js
// Wake Lock のスタブ（Task 6 で実体に差し替える）。
// これにより Task 4/5 で syncWakeLock() を呼んでも各コミットが動作する。
function syncWakeLock() {}
```
を削除し、`// --- Tick ---` の直前に以下の本実装を追加する:

```js
// --- Wake Lock（画面常時点灯） ---
let wakeLockSentinel = null;
async function syncWakeLock() {
  const want = state.wakeLockOn && state.stopwatch.running && document.visibilityState === 'visible';
  try {
    if (want && !wakeLockSentinel && navigator.wakeLock) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } else if (!want && wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (e) {
    // 非対応(iOS16.4未満等)やユーザー拒否は no-op
    wakeLockSentinel = null;
  }
}
// 復帰時に再取得（iOSはタブ非表示で自動解放されるため）
document.addEventListener('visibilitychange', () => { syncWakeLock(); });
```

- [ ] **Step 2: 記録・破棄・リセットで Wake Lock を解放**

`btn-record` / `btn-discard` / `btn-reset` の各ハンドラ内、`renderAll();` の直前にそれぞれ `syncWakeLock();` を追加する。

`btn-discard` 例（置換前）:
```js
$('btn-discard').addEventListener('click', () => {
  state.stopwatch.running = false;
  state.stopwatch.startedAt = null;
  state.stopwatch.elapsedMs = 0;
  saveState(state);
  renderAll();
});
```

置換後:
```js
$('btn-discard').addEventListener('click', () => {
  state.stopwatch.running = false;
  state.stopwatch.startedAt = null;
  state.stopwatch.elapsedMs = 0;
  saveState(state);
  syncWakeLock();
  renderAll();
});
```

同様に `btn-record` と `btn-reset` のハンドラ末尾の `renderAll();` の直前に `syncWakeLock();` を1行追加する（走行停止に伴い画面ロックを許可するため）。

- [ ] **Step 3: 初期化時に Wake Lock 状態を反映**

ファイル末尾の `renderAll();`（`// --- Init ---` 内）の直後に追加:

```js
syncWakeLock();   // リロード時に running かつ wakeLockOn なら再取得
```

- [ ] **Step 4: 実機で確認（executing 時、対応端末）**

Expected: 「休憩中は画面を消さない」ON＋スタートで画面が消えない。記録/破棄で通常に戻る。非対応端末ではチェックしても無害（no-op）。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): Wake Lockで画面常時点灯トグルを実装"
```

---

## Task 7: Service Worker キャッシュ更新

**Files:**
- Modify: `sw.js`（`CACHE_NAME` bump、precache 配列に countdown.js 追加）

- [ ] **Step 1: `CACHE_NAME` を bump**

置換前:
```js
const CACHE_NAME = CACHE_PREFIX + 'v274';
```
置換後:
```js
const CACHE_NAME = CACHE_PREFIX + 'v275';
```

- [ ] **Step 2: precache 配列に新JSを追加**

`sw.js` の precache 配列（`'./tools/js/stands-app.js'` 等が並ぶ箇所）に1行追加:

置換前:
```js
  './tools/js/stands-app.js',
```
置換後:
```js
  './tools/js/stands-app.js',
  './tools/js/countdown.js',
```

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-countdown
git add sw.js
git commit -m "chore(sw): countdown.js追加に伴いCACHE_NAME v275へbump"
```

---

## Task 8: 検証（ユニット＋実ブラウザスモーク）＋ dev 反映

**Files:** なし（検証とデプロイ）

- [ ] **Step 1: ユニットテスト全通過**

Run: `cd ~/work/taxi-countdown && node --test tests/*.test.js`
Expected: 全 PASS（countdown.test.js 含む）。

- [ ] **Step 2: 実ブラウザ（kimi-webbridge＝実アカウント）でスモーク**

spec §7 のチェックを実施:
1. カウントダウン切替 → 27分 → スタート → 残りが減る
2. 途中で `記録` → 実経過（目標未満）が合計休憩に正しく加算される
3. 0クロスで音（soundON）/赤フラッシュ/超過カウント継続、soundOFFで無音
4. アップ↔ダウン往復で内部経過が保たれる
5. リロードで mode/target/running/soundOn/wakeLockOn 復元、再読込で誤発火しない
6. 「画面を消さない」ON＋スタートで画面が消えない（対応端末）

- [ ] **Step 3: dev へ反映**

`!~/work/taxi-countdown/dpush.sh ~/work/taxi-countdown`（worktree対応の dev反映スクリプトをユーザーが実行）。dev確認URLで PWA 再起動を案内（新SW v275 反映確認）。

- [ ] **Step 4: 本番は別途ユーザー承認後**

dev で目視OK後、ユーザー承認を得てから本番（v*タグ）。本Phaseの計画範囲外。

---

## Self-Review

- **Spec coverage:**
  - §2 内部温存 / §6 純粋関数 → Task1, Task4（記録ロジック無変更を維持）
  - §3.1 モード切替 → Task3, Task4
  - §3.2 目標プリセット＋自由入力 → Task3, Task4
  - §3.3 表示（残り/超過/over赤） → Task4 Step1
  - §3.5 音トグル(soundOn)・Wake Lock → Task3, Task4, Task5(音), Task6(wakelock)
  - §4 0通知（音ON/OFF・バイブ・赤フラッシュ・1回・再読込誤発火防止） → Task2 Step4(再武装), Task5
  - §5 データモデル（mode/countdownTargetMin/soundOn/wakeLockOn・後方互換） → Task1(normalize), Task2
  - §7 テスト（ユニット＋kimi-webbridge）・SW bump → Task1, Task7, Task8
- **Placeholder scan:** プレースホルダ無し。全ステップに実コード/実コマンドを記載。
- **Type consistency:** `computeRemainingMs/fmtCountdown/crossedZero/normalizeTimerState` の名称、`state.mode/countdownTargetMin/soundOn/wakeLockOn`、`syncWakeLock/ensureAudio/beep/fireZeroNotification/setMode/setCountdownTarget`、`prevRemainingMs/countdownNotified` を全タスクで統一。`syncWakeLock` は Task2 でスタブ定義し Task4/5 で呼び出し、Task6 で本実装へ置換 → 各コミットが常に動作する（未定義参照なし）。

# 休憩タイマー履歴 ハイブリッドFirestore同期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 休憩タイマーの履歴をlocalStorage正本のままFirestoreにバックアップ同期し、機種変更/再インストールでも復元、2台併用でも記録を失わないようにする。

**Architecture:** localStorageが正本（既存動作・速度・オフライン不変）。Firestore `timerStates/{userId}` 1ドキュメントにベストエフォートでバックアップ。読み込み/前面復帰でpull→純粋関数でマージ→保存＋push、変更でデバウンスpush。recordはid+updatedAt+削除墓石でマージ（union/後勝ち）、設定はsettingsUpdatedAt後勝ち。

**Tech Stack:** Vanilla JS(ESM)、Firebase Firestore SDK 11.6.1、`node --test`。

参照spec: `docs/superpowers/specs/2026-06-07-timer-history-cloud-sync-design.md`

---

## File Structure

- **Create** `tools/js/timer-sync.js` — 純粋ロジック（`newRecordId`/`ensureRecordIds`/`mergeRecords`/`mergeSyncDocs`/`SETTINGS_KEYS`/`pickSettings`）。副作用なし・テスト対象。
- **Create** `tools/js/timer-cloud.js` — Firestore I/O（`pullTimerState`/`pushTimerState`）。薄いラッパ。
- **Create** `tests/timer-sync.test.js` — 純粋関数テスト。
- **Modify** `tools/index.html` — record schema(id/updatedAt/deleted)・活動レコードフィルタ・移行・settingsUpdatedAt・同期配線。
- **Modify** `firestore.rules` — `timerStates/{userId}` 所有者ルール追加。
- **Modify** `sw.js` — 新規2JSをprecache追加＋CACHE_NAME bump。

---

## Task 1: 純粋ロジック `tools/js/timer-sync.js`（TDD）

**Files:**
- Create: `tools/js/timer-sync.js`
- Test: `tests/timer-sync.test.js`

- [ ] **Step 1: 失敗するテストを書く** — create `tests/timer-sync.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  ensureRecordIds, mergeRecords, mergeSyncDocs, pickSettings, SETTINGS_KEYS,
} from '../tools/js/timer-sync.js';

test('ensureRecordIds: id無しはlegacy決定的id付与・updatedAtはrecordedAt由来・deleted既定false', () => {
  const out = ensureRecordIds([{ recordedAt: '2026-06-07T01:00:00.000Z', durationSec: 600 }]);
  assert.equal(out[0].id, 'legacy-2026-06-07T01:00:00.000Z');
  assert.equal(out[0].durationSec, 600);
  assert.equal(out[0].deleted, false);
  assert.equal(out[0].updatedAt, Date.parse('2026-06-07T01:00:00.000Z'));
});

test('ensureRecordIds: 既存id/updatedAt/deletedは保持', () => {
  const out = ensureRecordIds([{ id: 'x1', recordedAt: 'r', durationSec: 60, updatedAt: 999, deleted: true }]);
  assert.deepEqual(out[0], { id: 'x1', recordedAt: 'r', durationSec: 60, updatedAt: 999, deleted: true });
});

test('ensureRecordIds: 非配列は空配列', () => {
  assert.deepEqual(ensureRecordIds(null), []);
});

test('mergeRecords: union（片側だけのidも残る）', () => {
  const a = [{ id: 'a', recordedAt: 'ra', durationSec: 1, updatedAt: 1, deleted: false }];
  const b = [{ id: 'b', recordedAt: 'rb', durationSec: 2, updatedAt: 1, deleted: false }];
  const m = mergeRecords(a, b);
  assert.deepEqual(m.map(r => r.id).sort(), ['a', 'b']);
});

test('mergeRecords: 同idはupdatedAt新しい方（cloudが新しければcloud採用）', () => {
  const local = [{ id: 'x', recordedAt: 'old', durationSec: 1, updatedAt: 10, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'new', durationSec: 2, updatedAt: 20, deleted: false }];
  const m = mergeRecords(local, cloud);
  assert.equal(m.length, 1);
  assert.equal(m[0].recordedAt, 'new');
});

test('mergeRecords: updatedAt同点はlocal優先', () => {
  const local = [{ id: 'x', recordedAt: 'L', durationSec: 1, updatedAt: 5, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'C', durationSec: 2, updatedAt: 5, deleted: false }];
  assert.equal(mergeRecords(local, cloud)[0].recordedAt, 'L');
});

test('mergeRecords: 墓石は残る（削除がより新しければdeleted=trueを採用）', () => {
  const local = [{ id: 'x', recordedAt: 'r', durationSec: 1, updatedAt: 10, deleted: false }];
  const cloud = [{ id: 'x', recordedAt: 'r', durationSec: 1, updatedAt: 20, deleted: true }];
  const m = mergeRecords(local, cloud);
  assert.equal(m[0].deleted, true);
});

test('pickSettings: SETTINGS_KEYSだけ抽出', () => {
  const st = { mode: 'down', soundOn: false, records: [1], stopwatch: {}, foo: 1 };
  const s = pickSettings(st);
  assert.equal(s.mode, 'down');
  assert.equal(s.soundOn, false);
  assert.ok(!('records' in s) && !('stopwatch' in s) && !('foo' in s));
  assert.ok(SETTINGS_KEYS.includes('countdownPresets'));
});

test('mergeSyncDocs: recordsはmerge、settingsはsettingsUpdatedAt後勝ち', () => {
  const local = { records: [{ id: 'a', recordedAt: 'ra', durationSec: 1, updatedAt: 1, deleted: false }], settings: { mode: 'up' }, settingsUpdatedAt: 100 };
  const cloud = { records: [{ id: 'b', recordedAt: 'rb', durationSec: 2, updatedAt: 1, deleted: false }], settings: { mode: 'down' }, settingsUpdatedAt: 200 };
  const m = mergeSyncDocs(local, cloud);
  assert.deepEqual(m.records.map(r => r.id).sort(), ['a', 'b']);
  assert.equal(m.settings.mode, 'down');        // cloudのsettingsUpdatedAtが新しい
  assert.equal(m.settingsUpdatedAt, 200);
});

test('mergeSyncDocs: cloudがnullならlocalそのまま', () => {
  const local = { records: [], settings: { mode: 'up' }, settingsUpdatedAt: 100 };
  assert.deepEqual(mergeSyncDocs(local, null), local);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-countdown && node --test tests/timer-sync.test.js`
Expected: FAIL（`Cannot find module '../tools/js/timer-sync.js'`）

- [ ] **Step 3: 実装** — create `tools/js/timer-sync.js`:

```js
// 休憩タイマー履歴の同期用 純粋ロジック（副作用なし）。
// ブラウザは tools/index.html から import、テストは node --test から import。

// 同期するsettingsフィールド（順序固定）。
export const SETTINGS_KEYS = [
  'shiftStart', 'targetBreakMin', 'continuousDriveMin', 'breakCountMin',
  'mode', 'countdownTargetMin', 'soundOn', 'wakeLockOn', 'alertDurationSec',
  'moveDetectOn', 'moveThresholdM', 'countdownPresets',
];

// 新規record用の一意ID（ブラウザ実行時。テストでは未使用）。
export function newRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// 既存recordにid/updatedAt/deletedを補完（移行）。id無しはrecordedAt由来の決定的legacy id。
// 2端末で同じrecordedAtなら同じid→重複しない。純粋。
export function ensureRecordIds(records) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => ({
    id: r.id || ('legacy-' + (r.recordedAt || '')),
    recordedAt: r.recordedAt,
    durationSec: r.durationSec,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : (Date.parse(r.recordedAt) || 0),
    deleted: r.deleted === true,
  }));
}

// idでグルーピングし、各idは updatedAt が新しい方を採用（同点はlocal優先）。墓石も保持。純粋。
export function mergeRecords(localRecs, cloudRecs) {
  const byId = new Map();
  const consider = (r, isLocal) => {
    if (!r || r.id == null) return;
    const ex = byId.get(r.id);
    if (!ex) { byId.set(r.id, r); return; }
    const a = Number(r.updatedAt) || 0;
    const b = Number(ex.updatedAt) || 0;
    if (a > b || (a === b && isLocal)) byId.set(r.id, r);
  };
  (Array.isArray(cloudRecs) ? cloudRecs : []).forEach((r) => consider(r, false));
  (Array.isArray(localRecs) ? localRecs : []).forEach((r) => consider(r, true));
  return [...byId.values()];
}

// stateライクなオブジェクトから SETTINGS_KEYS だけ抽出。純粋。
export function pickSettings(state) {
  const s = {};
  const src = (state && typeof state === 'object') ? state : {};
  for (const k of SETTINGS_KEYS) s[k] = src[k];
  return s;
}

// 同期ドキュメント {records, settings, settingsUpdatedAt} をマージ。
// recordsは mergeRecords、settingsは settingsUpdatedAt が新しい方を採用。純粋。
export function mergeSyncDocs(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local;
  const lU = Number(local && local.settingsUpdatedAt) || 0;
  const cU = Number(cloud.settingsUpdatedAt) || 0;
  const useCloud = cU > lU;
  return {
    records: mergeRecords(local && local.records, cloud.records),
    settings: useCloud ? cloud.settings : (local && local.settings),
    settingsUpdatedAt: Math.max(lU, cU),
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd ~/work/taxi-countdown && node --test tests/timer-sync.test.js`
Expected: PASS（全11テスト）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/js/timer-sync.js tests/timer-sync.test.js
git commit -m "feat(timer): 履歴同期の純粋ロジック(timer-sync) + テスト"
```

---

## Task 2: record スキーマ拡張・活動フィルタ・移行・settingsUpdatedAt

**Files:**
- Modify: `tools/index.html`

注: 以降の編集は `<script type="module">` 内。`import` 行に timer-sync の関数を追加する。

- [ ] **Step 1: import に timer-sync を追加**

Find:
```js
import { computeRemainingMs, fmtCountdown, crossedZero, normalizeTimerState, fmtClockShort, overtimeNote, distanceMeters, normalizeCountdownPresets } from './js/countdown.js';
```
Replace with:
```js
import { computeRemainingMs, fmtCountdown, crossedZero, normalizeTimerState, fmtClockShort, overtimeNote, distanceMeters, normalizeCountdownPresets } from './js/countdown.js';
import { newRecordId, ensureRecordIds, mergeSyncDocs, pickSettings } from './js/timer-sync.js';
```

- [ ] **Step 2: normalizeTimerState に settingsUpdatedAt を追加**

`tools/js/countdown.js` の `normalizeTimerState` 戻り値（`countdownPresets:` の行の直後）に追加:

Find（countdown.js）:
```js
    // カウントダウン目標プリセット(分)6個。ユーザー編集可能。
    countdownPresets: normalizeCountdownPresets(p.countdownPresets),
  };
}
```
Replace with:
```js
    // カウントダウン目標プリセット(分)6個。ユーザー編集可能。
    countdownPresets: normalizeCountdownPresets(p.countdownPresets),
    // 設定の最終更新時刻(ms)。設定LWWマージ用。
    settingsUpdatedAt: (Number.isFinite(p.settingsUpdatedAt) && p.settingsUpdatedAt >= 0) ? p.settingsUpdatedAt : 0,
  };
}
```

- [ ] **Step 3: state初期化に settingsUpdatedAt を追加し、ロード時に record移行**

Find:
```js
  countdownPresets: _loaded.countdownPresets,
  stopwatch: _loaded.runningStartedAt
```
Replace with:
```js
  countdownPresets: _loaded.countdownPresets,
  settingsUpdatedAt: _loaded.settingsUpdatedAt,
  stopwatch: _loaded.runningStartedAt
```

そして `const state = { ... };` の閉じ `};` の直後に追加（移行: 既存recordにid等を付与）:
```js
// 既存recordにid/updatedAt/deletedを補完（移行）。以後 records は墓石を含む全集合。
state.records = ensureRecordIds(state.records);
```

- [ ] **Step 4: saveState に settingsUpdatedAt（変更検知でbump）と記録の永続化**

Find the whole `saveState`:
```js
function saveState(state) {
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
    wakeLockOn: state.wakeLockOn,
    alertDurationSec: state.alertDurationSec,
    moveDetectOn: state.moveDetectOn,
    moveThresholdM: state.moveThresholdM,
    countdownPresets: state.countdownPresets
  };
  if (state.stopwatch.running && state.stopwatch.startedAt) {
    data.runningStartedAt = state.stopwatch.startedAt;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
```
Replace with:
```js
function saveState(state) {
  // 設定が前回保存から変わっていれば settingsUpdatedAt を更新（設定LWW用・ここ1箇所だけ）
  try {
    const prevRaw = localStorage.getItem(STORAGE_KEY);
    const prevSettings = prevRaw ? pickSettings(JSON.parse(prevRaw)) : null;
    if (JSON.stringify(prevSettings) !== JSON.stringify(pickSettings(state))) {
      state.settingsUpdatedAt = Date.now();
    }
  } catch (e) { /* 比較失敗時は据え置き */ }
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
    wakeLockOn: state.wakeLockOn,
    alertDurationSec: state.alertDurationSec,
    moveDetectOn: state.moveDetectOn,
    moveThresholdM: state.moveThresholdM,
    countdownPresets: state.countdownPresets,
    settingsUpdatedAt: state.settingsUpdatedAt
  };
  if (state.stopwatch.running && state.stopwatch.startedAt) {
    data.runningStartedAt = state.stopwatch.startedAt;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  scheduleCloudPush();   // 変更をデバウンスでクラウドへ（Task 4で定義。未定義回避のためTask4まで下のスタブ）
}
```

- [ ] **Step 5: `scheduleCloudPush` スタブを置く（Task 4 で実体化）**

`function saveState` の直前に追加:
```js
// クラウドpushのスタブ（Task 4 で実体に置換）。saveStateから呼ぶため先に定義。
function scheduleCloudPush() {}
```

- [ ] **Step 6: 活動レコードのヘルパーと表示フィルタ**

`function currentStopwatchMs()` の直前に追加:
```js
// 表示・集計用：墓石(deleted)を除いた活動レコード。
function activeRecords() { return state.records.filter((r) => !r.deleted); }
```

次に表示・集計の `state.records` を `activeRecords()` に置換（保存・同期は全集合のままにする）:

(a) Find: `const recordedMin = Math.floor(state.records.reduce((s, r) => s + r.durationSec, 0) / 60);`
   Replace: `const recordedMin = Math.floor(activeRecords().reduce((s, r) => s + r.durationSec, 0) / 60);`

(b) Find: `const totalBreakSec = state.records.reduce((s, r) => s + r.durationSec, 0);`
   Replace: `const totalBreakSec = activeRecords().reduce((s, r) => s + r.durationSec, 0);`

(c) 履歴件数とソート（renderHistory）。
   Find: `$('history-count').textContent = state.records.length;`
   Replace: `$('history-count').textContent = activeRecords().length;`
   Find: `const sorted = [...state.records].sort(`
   Replace: `const sorted = [...activeRecords()].sort(`

(d) 基準時刻（renderMetrics）。
   Find:
```js
  if (state.records.length > 0) {
    baseDate = new Date(state.records[state.records.length - 1].recordedAt);
```
   Replace:
```js
  const _active = activeRecords();
  if (_active.length > 0) {
    baseDate = new Date(_active[_active.length - 1].recordedAt);
```

(e) リセットの hasData 判定2箇所。
   Find: `const hasData = state.records.length > 0 || state.shiftStartAt !== null;`
   Replace: `const hasData = activeRecords().length > 0 || state.shiftStartAt !== null;`
   Find: `const hasData = state.records.length > 0 || state.shiftStartAt !== null || state.stopwatch.running;`
   Replace: `const hasData = activeRecords().length > 0 || state.shiftStartAt !== null || state.stopwatch.running;`

- [ ] **Step 7: record作成にid/updatedAt/deletedを付与（2箇所）**

(a) btn-record。Find:
```js
  const record = {
    recordedAt: new Date().toISOString(),
    durationSec: Math.floor(ms / 1000)
  };
  state.records.push(record);
```
Replace:
```js
  const now = Date.now();
  const record = {
    id: newRecordId(),
    recordedAt: new Date(now).toISOString(),
    durationSec: Math.floor(ms / 1000),
    updatedAt: now,
    deleted: false
  };
  state.records.push(record);
```

(b) move-detect-yes。Find:
```js
    if (durationSec >= state.breakCountMin * 60) {
      state.records.push({ recordedAt: new Date(end).toISOString(), durationSec });
    }
```
Replace:
```js
    if (durationSec >= state.breakCountMin * 60) {
      state.records.push({ id: newRecordId(), recordedAt: new Date(end).toISOString(), durationSec, updatedAt: Date.now(), deleted: false });
    }
```

- [ ] **Step 8: 編集はidを保持・updatedAt更新（編集ダイアログのキーをidに）**

編集ダイアログは `editingRecordedAt` をキーにしている。idベースに変える。

(a) Find（openEditDialog付近の変数）: `let editingRecordedAt = null;`
   Replace: `let editingRecordedId = null;`

(b) openEditDialog 内 `editingRecordedAt = record.recordedAt;` を Find→ Replace: `editingRecordedId = record.id;`

(c) computeEditedRange 内 `const rec = state.records.find(x => x.recordedAt === editingRecordedAt);` を Find→ Replace: `const rec = state.records.find(x => x.id === editingRecordedId);`

(d) edit-cancel の `editingRecordedAt = null;` を Find→ Replace: `editingRecordedId = null;`

(e) edit-save。Find:
```js
  const idx = state.records.findIndex(x => x.recordedAt === editingRecordedAt);
  if (idx < 0) { $('edit-dialog').close(); return; }
  state.records[idx] = {
    recordedAt: r.endDate.toISOString(),
    durationSec: r.durationSec
  };
  editingRecordedAt = null;
```
Replace:
```js
  const idx = state.records.findIndex(x => x.id === editingRecordedId);
  if (idx < 0) { $('edit-dialog').close(); return; }
  state.records[idx] = {
    ...state.records[idx],
    recordedAt: r.endDate.toISOString(),
    durationSec: r.durationSec,
    updatedAt: Date.now()
  };
  editingRecordedId = null;
```

- [ ] **Step 9: 削除は墓石（deleted=true）に**

Find:
```js
      state.records = state.records.filter(x => x.recordedAt !== r.recordedAt);
      saveState(state);
      renderAll();
```
Replace:
```js
      const di = state.records.findIndex(x => x.id === r.id);
      if (di >= 0) state.records[di] = { ...state.records[di], deleted: true, updatedAt: Date.now() };
      saveState(state);
      renderAll();
```

- [ ] **Step 10: 既存テスト＋構文確認**

Run: `cd ~/work/taxi-countdown && node --test tests/*.test.js` → 全PASS（index.htmlはブラウザ専用で無影響）。
構文チェック: `S=$(grep -n '<script type="module">' tools/index.html | sed -n '2p' | cut -d: -f1); E=$(awk 'NR>'"$S"' && /<\/script>/{print NR; exit}' tools/index.html); sed -n "$((S+1)),$((E-1))p" tools/index.html > /tmp/c.mjs && node --check /tmp/c.mjs && echo OK`

- [ ] **Step 11: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html tools/js/countdown.js
git commit -m "feat(timer): recordにid/updatedAt/削除墓石 + 活動フィルタ + settingsUpdatedAt + 移行"
```

---

## Task 3: Firestore I/O `tools/js/timer-cloud.js`

**Files:**
- Create: `tools/js/timer-cloud.js`

- [ ] **Step 1: 実装** — create `tools/js/timer-cloud.js`:

```js
// 休憩タイマー履歴の Firestore I/O。timerStates/{userId} の1ドキュメント。
// localStorage正本のバックアップ層。全てベストエフォート（失敗は呼び出し側で握りつぶす）。
import { db } from '../../js/firebase-init.js';
import { getUserId } from '../../js/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

function ref() {
  const uid = getUserId();
  if (!uid) return null;
  return doc(db, 'timerStates', uid);
}

// クラウドの同期ドキュメントを取得。無ければ null。未ログイン/失敗時も null（呼び出し側でlocal維持）。
export async function pullTimerState() {
  const r = ref();
  if (!r) return null;
  const snap = await getDoc(r);
  if (!snap.exists()) return null;
  const d = snap.data() || {};
  return {
    records: Array.isArray(d.records) ? d.records : [],
    settings: (d.settings && typeof d.settings === 'object') ? d.settings : {},
    settingsUpdatedAt: Number(d.settingsUpdatedAt) || 0,
  };
}

// 同期ドキュメント {records, settings, settingsUpdatedAt} をクラウドへ全体上書き保存。
export async function pushTimerState(syncDoc) {
  const r = ref();
  if (!r) return;
  await setDoc(r, {
    records: Array.isArray(syncDoc.records) ? syncDoc.records : [],
    settings: syncDoc.settings || {},
    settingsUpdatedAt: Number(syncDoc.settingsUpdatedAt) || 0,
    syncedAt: serverTimestamp(),
  });
}
```

- [ ] **Step 2: 構文確認**

Run: `cd ~/work/taxi-countdown && node --check tools/js/timer-cloud.js 2>&1 | head` — ESM外部URL importは `node --check` では解決しないが構文は通る（エラーが「module不可」系でなく構文系で無いこと）。難しければスキップしブラウザスモークで確認。

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/js/timer-cloud.js
git commit -m "feat(timer): Firestore I/O(timer-cloud) timerStates/{userId}"
```

---

## Task 4: 同期の配線（pull/merge/push）

**Files:**
- Modify: `tools/index.html`

- [ ] **Step 1: import に timer-cloud と auth待ちを追加**

Find:
```js
import { newRecordId, ensureRecordIds, mergeSyncDocs, pickSettings } from './js/timer-sync.js';
```
Replace:
```js
import { newRecordId, ensureRecordIds, mergeSyncDocs, pickSettings } from './js/timer-sync.js';
import { pullTimerState, pushTimerState } from './js/timer-cloud.js';
import { waitForAuth } from '../js/firebase-auth.js';
```

- [ ] **Step 2: スタブ `scheduleCloudPush` を実体化**

Find the stub:
```js
// クラウドpushのスタブ（Task 4 で実体に置換）。saveStateから呼ぶため先に定義。
function scheduleCloudPush() {}
```
Replace:
```js
// --- クラウド同期 ---
function toSyncDoc() {
  return { records: state.records, settings: pickSettings(state), settingsUpdatedAt: state.settingsUpdatedAt };
}
function applyMerged(merged) {
  state.records = ensureRecordIds(merged.records);
  const s = merged.settings || {};
  for (const k of Object.keys(pickSettings(state))) {
    if (k in s && s[k] !== undefined) state[k] = s[k];
  }
  state.settingsUpdatedAt = Number(merged.settingsUpdatedAt) || state.settingsUpdatedAt;
}

let cloudPushTimer = null;
// 変更をデバウンス(4秒)でクラウドへ。オンライン＆ログイン時のみ・失敗は握りつぶす。
function scheduleCloudPush() {
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    cloudPushTimer = null;
    if (!navigator.onLine) return;
    pushTimerState(toSyncDoc()).catch(() => {});
  }, 4000);
}

let lastCloudSync = 0;
// クラウドを取得→マージ→localStorage保存＋再描画＋書き戻し。失敗してもUIは止めない。
async function syncWithCloud() {
  if (!navigator.onLine) return;
  try { await waitForAuth(); } catch (e) { return; }
  let cloud = null;
  try { cloud = await pullTimerState(); } catch (e) { return; }
  const merged = mergeSyncDocs(toSyncDoc(), cloud);
  applyMerged(merged);
  saveState(state);          // 内部で再度scheduleCloudPushされるが、直後にpushするので問題なし
  renderAll();
  lastCloudSync = Date.now();
  try { await pushTimerState(toSyncDoc()); } catch (e) {}
}
```

注: `saveState` が `scheduleCloudPush` を呼ぶ循環に注意。`syncWithCloud` は最後に直接 `pushTimerState` するので冗長pushはデバウンスで吸収される（実害なし）。

- [ ] **Step 3: ロード時と前面復帰時に同期**

ファイル末尾 `// --- Init ---` の `renderAll();` 群の後（`if (state.stopwatch.running) startMoveWatch();` の直後）に追加:
```js
syncWithCloud();   // 初回: クラウドから復元/マージ
```

前面復帰での同期。既存の visibilitychange リスナー（`syncWakeLock()` を呼ぶもの）を Find:
```js
document.addEventListener('visibilitychange', () => { syncWakeLock(); });
```
Replace:
```js
document.addEventListener('visibilitychange', () => {
  syncWakeLock();
  // 前面復帰時にクラウド取り込み（直近5秒の重複は抑制）
  if (document.visibilityState === 'visible' && Date.now() - lastCloudSync > 5000) syncWithCloud();
});
```

- [ ] **Step 4: 既存テスト＋構文確認**

Run: `cd ~/work/taxi-countdown && node --test tests/*.test.js` → PASS。
構文: Task2 Step10と同じ手順で `node --check` OK。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-countdown
git add tools/index.html
git commit -m "feat(timer): クラウド同期配線(ロード/前面でpull+merge+push, 変更でデバウンスpush)"
```

---

## Task 5: Firestore セキュリティルール

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: `userConfigs` のmatchブロックの直後に追加**

Find:
```
    match /userConfigs/{userId} {
      allow read, write: if isOwnerByUserId(userId);
      allow read, write: if isAdmin();
    }
```
Replace:
```
    match /userConfigs/{userId} {
      allow read, write: if isOwnerByUserId(userId);
      allow read, write: if isAdmin();
    }

    match /timerStates/{userId} {
      allow read, write: if isOwnerByUserId(userId);
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 2: コミット**

```bash
cd ~/work/taxi-countdown
git add firestore.rules
git commit -m "feat(timer): firestore.rules に timerStates/{userId} 所有者ルール追加"
```

---

## Task 6: Service Worker キャッシュ

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: precache に新規2JSを追加**

Find:
```js
  './tools/js/countdown.js',
```
Replace:
```js
  './tools/js/countdown.js',
  './tools/js/timer-sync.js',
  './tools/js/timer-cloud.js',
```

- [ ] **Step 2: CACHE_NAME を bump**

`sw.js` の `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` の数字を +1（push時に origin と衝突したら origin の最新+1 に解決）。

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-countdown
git add sw.js
git commit -m "chore(sw): timer-sync/timer-cloud をprecache追加 + CACHE_NAME bump"
```

---

## Task 7: 検証＋デプロイ

**Files:** なし（検証とデプロイ）

- [ ] **Step 1: ユニット全通過**

Run: `cd ~/work/taxi-countdown && node --test tests/*.test.js` → 全PASS（timer-sync含む）。

- [ ] **Step 2: 実ブラウザ(kimi-webbridge=実アカウント)でスモーク**

[[reference_taxi-tool-page-smoke-test]] のseed手順でゲート通過後、dev の `/tools/` で:
1. 休憩を記録→数秒後にFirestoreへpushされる（Firestoreコンソール or 別タブpullで確認）
2. localStorageを空にして同アカウントでリロード→クラウドから復元
3. 端末A/B相当(別localStorage、同seed)で別々に記録→マージで両方残る／一方で削除→墓石で復活しない
4. 設定変更が新しい端末で勝つ（settingsUpdatedAt後勝ち）
5. オフライン/未ログインでUIが止まらない（navigator.onLine=false でも記録できる）

- [ ] **Step 3: dev 反映（ページ）＋ Firestoreルール デプロイ**

ページ: `!~/work/taxi-dev/dpush.sh ~/work/taxi-countdown`（ユーザー実行・SW衝突は解決）。
ルール: `firebase deploy --only firestore:rules --project default`（dev）。**ルールを先に入れないと書き込みが拒否される**ので、スモーク前にdevルールを入れること。

- [ ] **Step 4: 本番はユーザー承認後**

dev実機OK後、本番ページ（v*タグ）＋ `firebase deploy --only firestore:rules --project prod`。本Planの範囲外。

---

## Self-Review

- **Spec coverage:**
  - §3 データモデル(id/updatedAt/deleted, timerStates/{uid}, settings, settingsUpdatedAt) → Task1,2,3
  - §4 マージ(union/後勝ち/墓石, settings LWW) → Task1(mergeRecords/mergeSyncDocs), Task2(墓石)
  - §5 同期フロー(ロード/前面pull, 変更デバウンスpush, onSnapshot無し) → Task4
  - §6 セキュリティルール(isOwnerByUserId) → Task5
  - §7 移行(ensureRecordIds, 初回push) → Task2 Step3, Task4(初回syncWithCloud)
  - §8 ファイル構成 → 全タスク／ §9 テスト → Task1, Task7
- **Placeholder scan:** スタブ(`scheduleCloudPush`)はTask2で定義しTask4で実体化（各コミット動作）。プレースホルダ無し。
- **Type consistency:** record=`{id,recordedAt,durationSec,updatedAt,deleted}`、syncDoc=`{records,settings,settingsUpdatedAt}` を全タスクで統一。`pickSettings`/`SETTINGS_KEYS`/`ensureRecordIds`/`mergeSyncDocs`/`newRecordId`/`pullTimerState`/`pushTimerState`/`toSyncDoc`/`applyMerged`/`activeRecords`/`scheduleCloudPush`/`syncWithCloud`/`editingRecordedId`/`lastCloudSync` 名称統一。

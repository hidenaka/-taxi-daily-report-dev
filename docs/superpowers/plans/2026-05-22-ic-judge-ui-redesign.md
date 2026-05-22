# IC判定ページ UI改善（案A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IC判定ページを「入口→出口→答え→ルート/詳細→ログ」の思考順に再構成し、入力の二重表示を解消、出口お気に入りを編集可能にする。

**Architecture:** 経路計算ロジック（judge.js / route-options.js / shutoko-graph.js / geo.js）は不変。描画関数（renderVerdict / renderRouteComparison / renderRoutePath / renderJctDetails / renderBreakdown / renderSessionLog）が参照するDOM IDを全て温存したまま、`ic.html`のセクション順序を入れ替え、入口/出口の入力をプルダウンからチップへ置換する。出口お気に入りは新規純関数モジュール`exit-favorites.js`でlocalStorage永続化する。

**Tech Stack:** Vanilla ES Modules（ビルドなし）、`node --test`（テストハーネス`tests/run.js`＝`{ test, assert }`）、Service Worker キャッシュ（`sw.js`）。

**作業ブランチ:** `feat/ic-judge-ui-redesign`（worktree `タクシー日報-wt-ic-ui`、dev/mainベース）。
**設計書:** `docs/superpowers/specs/2026-05-22-ic-judge-ui-redesign-design.md`

---

## File Structure

| ファイル | 役割 | 操作 |
|---------|------|------|
| `tools/js/exit-favorites.js` | 出口お気に入りの純関数（seed/load/add/remove/save） | 新規 |
| `tests/exit-favorites.test.js` | 上記のユニットテスト | 新規 |
| `tools/ic.html` | セクション順の再構成・入力チップ化・答えカード枠 | 変更 |
| `tools/css/style.css` | チップ主役化・答えカード強調・編集モードのスタイル | 変更 |
| `tools/js/app.js` | お気に入りlocalStorage化・チップ配線・答えカード表示制御・保存ボタン移設 | 変更 |
| `sw.js` | `exit-favorites.js`をキャッシュに追加・`CACHE_NAME`をbump | 変更 |
| `.company/pm/tickets/2026-05-15-ic-route-jct-selector.md` | 統合によりclose（※`.company`はリポ外・git対象外） | 変更 |

**温存必須のDOM ID**（描画関数が参照。改名禁止）:
`#badge-main` `#badge-deduction` `#badge-distance` `#route-notes` `#segment-breakdown`
`#route-comparison-section` `#route-tabs` `#route-tab-content`
`#route-path-section` `#route-path` `#route-jct-details` `#route-jct-list`
`#geo-status` `#geo-location` `#geo-accuracy` `#btn-geo-refresh` `#btn-geo-toggle`
`#geo-suggest` `#geo-suggest-buttons` `#sel-outer-route` `#chk-via-gaikan` `#label-via-gaikan` `#label-shutoko-route` `#sel-shutoko-route`
`#inp-entry-ic` `#entry-ic-hint` `#inp-exit-ic` `#exit-ic-hint` `#ic-list-all`
`#btn-swap-ic` `#btn-save-oneway` `#btn-save-roundtrip` `#btn-clear-log`
`#session-log` `#session-log-date` `#session-log-list` `#total-deduction` `#total-drivable`

**削除するDOM要素**（プルダウン廃止）: `#sel-entry-ic` `#sel-exit-fav` `#sel-exit-all`
**追加するDOM要素**: `#entry-selected` `#entry-search`(details) `#exit-selected` `#exit-fav-chips` `#btn-exit-edit` `#exit-search`(details) `#answer-card` `#answer-placeholder` `#answer-body` `#route-detail-collapse`(details)

---

## Task 1: 出口お気に入りの純関数モジュール（TDD）

**Files:**
- Create: `tools/js/exit-favorites.js`
- Test: `tests/exit-favorites.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/exit-favorites.test.js`:

```js
import { test, assert } from './run.js';
import {
  seedFavorites, loadFavorites, addFavorite, removeFavorite, saveFavorites, EXIT_FAVORITES_KEY,
} from '../tools/js/exit-favorites.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _raw: (k) => (m.has(k) ? m.get(k) : null),
  };
}

test('seedFavorites: defaults を保存して配列を返す', () => {
  const s = fakeStorage();
  const out = seedFavorites(['a', 'b'], s);
  assert.deepEqual(out, ['a', 'b']);
  assert.deepEqual(JSON.parse(s._raw(EXIT_FAVORITES_KEY)), ['a', 'b']);
});

test('loadFavorites: 未存在なら defaults でseed', () => {
  const s = fakeStorage();
  assert.deepEqual(loadFavorites(['x'], s), ['x']);
  // 2回目は保存済みを返す（再seedしない）
  assert.deepEqual(loadFavorites(['y'], s), ['x']);
});

test('loadFavorites: 保存済みを優先して返す', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: JSON.stringify(['p', 'q']) });
  assert.deepEqual(loadFavorites(['z'], s), ['p', 'q']);
});

test('loadFavorites: 破損JSONは defaults にフォールバック', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: '{not json' });
  assert.deepEqual(loadFavorites(['d'], s), ['d']);
});

test('loadFavorites: 配列でない値は defaults にフォールバック', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: JSON.stringify({ foo: 1 }) });
  assert.deepEqual(loadFavorites(['d'], s), ['d']);
});

test('addFavorite: 末尾に追加（純関数・元配列を変更しない）', () => {
  const base = ['a'];
  const out = addFavorite(base, 'b');
  assert.deepEqual(out, ['a', 'b']);
  assert.deepEqual(base, ['a']);
});

test('addFavorite: 重複は追加しない', () => {
  assert.deepEqual(addFavorite(['a', 'b'], 'a'), ['a', 'b']);
});

test('addFavorite: 空/null icId は無視', () => {
  assert.deepEqual(addFavorite(['a'], ''), ['a']);
  assert.deepEqual(addFavorite(['a'], null), ['a']);
});

test('removeFavorite: 該当を除去（純関数）', () => {
  const base = ['a', 'b', 'c'];
  assert.deepEqual(removeFavorite(base, 'b'), ['a', 'c']);
  assert.deepEqual(base, ['a', 'b', 'c']);
});

test('removeFavorite: 空配列も許容', () => {
  assert.deepEqual(removeFavorite(['a'], 'a'), []);
});

test('saveFavorites: localStorage へ永続化', () => {
  const s = fakeStorage();
  saveFavorites(['m', 'n'], s);
  assert.deepEqual(JSON.parse(s._raw(EXIT_FAVORITES_KEY)), ['m', 'n']);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test 2>&1 | grep -E "exit-favorites|Cannot find module"`
Expected: モジュール未存在で FAIL。

- [ ] **Step 3: 最小実装を書く**

`tools/js/exit-favorites.js`:

```js
// 出口IC お気に入りの永続化（localStorage）。純関数 + 薄いI/Oラッパ。
// storage 引数でテスト時にフェイクを注入できる（既定は globalThis.localStorage）。

export const EXIT_FAVORITES_KEY = 'cabis.exitFavorites';

const defaultStorage = () => globalThis.localStorage;

// defaults(ic_id配列) を保存して配列を返す
export function seedFavorites(defaults, storage = defaultStorage()) {
  const list = Array.isArray(defaults) ? defaults.filter(x => typeof x === 'string') : [];
  storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list));
  return list;
}

// localStorage優先で読む。未存在/破損/非配列なら defaults でseed
export function loadFavorites(defaults, storage = defaultStorage()) {
  const raw = storage.getItem(EXIT_FAVORITES_KEY);
  if (raw == null) return seedFavorites(defaults, storage);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string');
    return seedFavorites(defaults, storage);
  } catch {
    return seedFavorites(defaults, storage);
  }
}

// 重複なく末尾追加した新配列を返す（純関数）
export function addFavorite(list, icId) {
  if (!icId) return list;
  if (list.includes(icId)) return list;
  return [...list, icId];
}

// 除去した新配列を返す（純関数）
export function removeFavorite(list, icId) {
  return list.filter(id => id !== icId);
}

// localStorage へ永続化して配列を返す
export function saveFavorites(list, storage = defaultStorage()) {
  storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list));
  return list;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test 2>&1 | tail -8`
Expected: 全pass（445 + 新規11 = 456）。`# fail 0`。

- [ ] **Step 5: コミット**

```bash
git add tools/js/exit-favorites.js tests/exit-favorites.test.js
git commit -m "feat(ic): 出口お気に入りのlocalStorage純関数モジュール + テスト"
```

---

## Task 2: ic.html を案A構成に再構成

**Files:**
- Modify: `tools/ic.html`（`<nav class="app-tabs">`〜`</main>` の本文を差し替え）

- [ ] **Step 1: `<main class="app">` 内を以下に置換**

`tools/ic.html` の `<main class="app">` 開始タグから `</main>` 直前までを、次の内容に差し替える（`<main class="app">` と `</main>` 自体、および前後の `<nav class="app-tabs">`・末尾の `<script>`・`<div id="navHost">` は変更しない）:

```html
  <main class="app">
    <!-- ① 入口IC -->
    <section class="ic-step" id="step-entry">
      <div class="step-head">
        <span class="step-title"><span class="step-num">①</span> どこから乗った？<small>入口IC</small></span>
        <div class="geo-status" id="geo-status">
          <span id="geo-location">📍 未取得</span>
          <span id="geo-accuracy"></span>
        </div>
        <div class="geo-actions">
          <button id="btn-geo-refresh" type="button">再取得</button>
          <button id="btn-geo-toggle" type="button" aria-pressed="true">GPSオフ</button>
        </div>
      </div>
      <div class="ic-selected" id="entry-selected" hidden></div>
      <div class="geo-suggest" id="geo-suggest" hidden>
        <span class="geo-suggest-label">📍 GPS近い順</span>
        <div class="geo-suggest-buttons" id="geo-suggest-buttons"></div>
      </div>
      <details class="ic-search" id="entry-search">
        <summary>🔍 別のICを検索</summary>
        <input type="text" id="inp-entry-ic" list="ic-list-all"
               placeholder="例: 鶴ヶ島" autocomplete="off" class="input-search">
        <div class="hint" id="entry-ic-hint"></div>
      </details>
    </section>

    <div class="swap-field">
      <button type="button" id="btn-swap-ic" class="btn-swap" title="入口と出口を入れ替える">
        ⇅ 入口と出口を入れ替える
      </button>
    </div>

    <!-- ② 出口IC -->
    <section class="ic-step" id="step-exit">
      <div class="step-head">
        <span class="step-title"><span class="step-num">②</span> どこで降りた？<small>出口IC</small></span>
        <button type="button" id="btn-exit-edit" class="btn-edit-fav">⚙ 編集</button>
      </div>
      <div class="ic-selected" id="exit-selected" hidden></div>
      <div class="fav-chips" id="exit-fav-chips"></div>
      <details class="ic-search" id="exit-search">
        <summary>🔍 別のICを検索</summary>
        <input type="text" id="inp-exit-ic" list="ic-list-all"
               placeholder="IC名で検索" autocomplete="off" class="input-search">
        <div class="hint" id="exit-ic-hint"></div>
      </details>
    </section>

    <datalist id="ic-list-all"></datalist>

    <!-- 経路の内部state（画面非表示・app.jsが参照） -->
    <section class="route-select" hidden>
      <select id="sel-outer-route"></select>
      <label id="label-via-gaikan" hidden>
        <input type="checkbox" id="chk-via-gaikan"> 外環経由
      </label>
      <label id="label-shutoko-route" hidden>
        <select id="sel-shutoko-route" class="input-pulldown"></select>
      </label>
    </section>

    <!-- ③ 答えカード -->
    <section class="answer-card" id="answer-card">
      <div class="answer-placeholder" id="answer-placeholder">入口と出口を選ぶと控除距離が出ます</div>
      <div class="answer-body" id="answer-body" hidden>
        <div class="badge-main" id="badge-main">—</div>
        <div class="badge-deduction" id="badge-deduction">—</div>
        <div class="badge-distance" id="badge-distance">—</div>
        <div class="route-notes" id="route-notes" hidden></div>
        <div class="save-buttons">
          <button id="btn-save-oneway" type="button" class="btn-save-oneway">片道だけ保存</button>
          <button id="btn-save-roundtrip" type="button" class="btn-save-roundtrip">往復で保存</button>
        </div>
      </div>
    </section>

    <!-- ④ ルート候補（複数時のみ） -->
    <section class="route-comparison" id="route-comparison-section" hidden>
      <h3 class="route-comparison-label">📊 ルート候補</h3>
      <div class="route-tabs" id="route-tabs"></div>
      <div class="route-tab-content" id="route-tab-content"></div>
    </section>

    <!-- ④詳細 通るルート / 通過IC・JCT / 区間内訳（1つの折りたたみに集約） -->
    <section class="route-path" id="route-path-section" hidden>
      <details class="route-detail-collapse" id="route-detail-collapse">
        <summary>🚗 通るルート / 通過IC・JCT / 区間内訳</summary>
        <div id="route-path" class="route-path-display"></div>
        <details id="route-jct-details" class="route-jct-details" open hidden>
          <summary>通過 IC / JCT</summary>
          <div id="route-jct-list" class="route-jct-list"></div>
        </details>
        <ul id="segment-breakdown"></ul>
      </details>
    </section>

    <!-- ⑤ 今日のログ -->
    <section class="session-log" id="session-log">
      <h3 class="session-log-title">📝 今日の控除距離 <span class="session-log-date" id="session-log-date"></span></h3>
      <ul id="session-log-list" class="session-log-list"></ul>
      <div class="session-totals">
        <div class="total-line" id="total-deduction">今日の控除距離合計: <strong>0.0</strong>km</div>
        <div class="total-line drivable" id="total-drivable">走行可能距離: <strong>365.0</strong>km <span class="formula">(365 + 控除距離合計)</span></div>
      </div>
      <button id="btn-clear-log" type="button" class="btn-clear-log">今日のログを消去</button>
    </section>
  </main>
```

注意：保存ボタン（`#btn-save-oneway`/`#btn-save-roundtrip`）は session-log から答えカードへ移設済み。session-log には保存ボタンを残さない。

- [ ] **Step 2: 構文確認（壊れていないか）**

Run: `node -e "const s=require('fs').readFileSync('tools/ic.html','utf8'); for(const id of ['badge-main','route-path-section','route-jct-details','segment-breakdown','geo-suggest-buttons','answer-body','exit-fav-chips','btn-save-oneway']){ if(!s.includes('id=\"'+id+'\"')) throw new Error('missing '+id);} console.log('ids ok');"`
Expected: `ids ok`

- [ ] **Step 3: コミット**

```bash
git add tools/ic.html
git commit -m "refactor(ic): ic.htmlを案A構成（入口→出口→答え→ルート→ログ）に再構成"
```

---

## Task 3: app.js をチップUI・お気に入りlocalStorage・答えカードに配線

**Files:**
- Modify: `tools/js/app.js`

- [ ] **Step 1: import を追加**

`tools/js/app.js` の import 群（先頭7行付近、`import { getOuterRouteOptionsForIc } from './route-options.js';` の下）に追加:

```js
import { loadFavorites, addFavorite, removeFavorite, saveFavorites } from './exit-favorites.js';
```

- [ ] **Step 2: お気に入り状態とレンダラを追加**

`// ---- Favorites pulldown ----` の `populateExitFavorites` 関数（既存）を、次の塊で**置換**する:

```js
// ---- 出口お気に入りチップ（localStorage・編集可） ----
let exitFavorites = [];   // ic_id 配列
let exitEditMode = false;

function defaultExitFavoriteIds() {
  return (state.data.favorites.exit_favorites || []).map(f => f.ic_id);
}

function initExitFavorites() {
  exitFavorites = loadFavorites(defaultExitFavoriteIds());
  renderExitFavorites();
}

function renderExitFavorites() {
  const wrap = document.getElementById('exit-fav-chips');
  wrap.innerHTML = '';
  for (const icId of exitFavorites) {
    const ic = state.data.ics.find(x => x.id === icId);
    if (!ic) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fav-chip' + (icId === state.selected.exitIcId ? ' sel' : '');
    chip.dataset.icId = icId;
    const name = ic.name.replace(/（[^）]*）/g, '').trim();
    chip.innerHTML = `<span class="star">★</span>${name}` +
      (exitEditMode ? `<span class="chip-remove" aria-label="削除">×</span>` : '');
    if (exitEditMode) {
      chip.querySelector('.chip-remove').addEventListener('click', (ev) => {
        ev.stopPropagation();
        exitFavorites = removeFavorite(exitFavorites, icId);
        saveFavorites(exitFavorites);
        renderExitFavorites();
      });
    }
    chip.addEventListener('click', () => {
      if (exitEditMode) return;
      setExitIc(icId); update();
    });
    wrap.appendChild(chip);
  }
  if (exitEditMode) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'fav-chip fav-add';
    add.textContent = '＋追加';
    add.addEventListener('click', () => {
      const det = document.getElementById('exit-search');
      det.open = true;
      document.getElementById('inp-exit-ic').focus();
    });
    wrap.appendChild(add);
  }
}

function renderIcSelected(elId, ic) {
  const el = document.getElementById(elId);
  if (!ic) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = '選択中: ' + ic.name.replace(/（[^）]*）/g, '').trim();
  el.hidden = false;
}

function markActiveEntryChip(icId) {
  document.querySelectorAll('#geo-suggest-buttons .btn-geo-suggest').forEach(b => {
    b.classList.toggle('sel', b.dataset.icId === icId);
  });
}

function refreshAnswerVisibility() {
  const ready = !!(state.selected.entryIcId && state.selected.exitIcId);
  document.getElementById('answer-placeholder').hidden = ready;
  document.getElementById('answer-body').hidden = !ready;
}
```

- [ ] **Step 3: setEntryIc / setExitIc を置換（プルダウン参照を除去）**

既存 `setEntryIc` を次に置換:

```js
function setEntryIc(icId) {
  const ic = state.data.ics.find(x => x.id === icId);
  if (!ic) return;
  state.selected.entryIcId = icId;

  updateOuterRouteOptions();  // 内部で outerRoute を再選択

  renderIcSelected('entry-selected', ic);
  markActiveEntryChip(icId);

  const hint = document.getElementById('entry-ic-hint');
  hint.textContent = (ic.route_name || '').replace(/（[^）]*）/g, '').trim();
  hint.className = 'hint';

  toggleGaikanCheckbox();
  updateShutokoRouteOptions();
}
```

既存 `setExitIc` を次に置換:

```js
function setExitIc(icId) {
  const ic = state.data.ics.find(x => x.id === icId);
  if (!ic) return;
  state.selected.exitIcId = icId;

  renderIcSelected('exit-selected', ic);
  renderExitFavorites();   // 選択チップのハイライト更新

  const hint = document.getElementById('exit-ic-hint');
  hint.textContent = (ic.route_name || '').replace(/（[^）]*）/g, '').trim();
  hint.className = 'hint';

  updateOuterRouteOptions();
  updateShutokoRouteOptions();
}
```

- [ ] **Step 4: refreshNearestSuggestions にチップのid付与と選択ハイライトを追加**

既存 `refreshNearestSuggestions` の for ループ内、`btn.textContent = ...;` の直前に2行追加し、選択中ならハイライト:

```js
    btn.dataset.icId = ic.id;
    if (ic.id === state.selected.entryIcId) btn.classList.add('sel');
```

（既存の `if (entryGivesCompanyPayDeduction(...)) { btn.classList.add('glow'); ... }` はそのまま残す）

- [ ] **Step 5: populateAllIcSelects 呼び出しと関数を削除、init を更新**

`init()` 内（既存）の以下2行を置換:

```js
  populateExitFavorites();
  populateAllIcSelects();
```
↓
```js
  initExitFavorites();
```

`setExitIc('kukou_chuou');` はそのまま残す（チップ＆選択表示を更新する）。
さらに、`populateAllIcSelects` 関数（`// ---- Populate both grouped pulldowns ...` のブロック全体、333〜354行付近）を**削除**する。datalist は `buildSearchIndex()` が引き続き生成する。

- [ ] **Step 6: update() に答えカード表示制御を追加**

既存 `update()` の先頭（`const icById = ...` の直前）に1行追加:

```js
function update() {
  refreshAnswerVisibility();
  const icById = (id) => state.data.ics.find(x => x.id === id);
```

- [ ] **Step 7: wireEvents を置換（廃止プルダウンのリスナ除去・チップ/編集を配線）**

既存 `wireEvents` 内の以下を**削除**:
- `document.getElementById('sel-entry-ic').addEventListener(...)` の行（entrySel関連、`const entrySel = ...` と `entrySel.addEventListener(...)`）
- `document.getElementById('sel-exit-fav').addEventListener(...)` ブロック
- `document.getElementById('sel-exit-all').addEventListener(...)` ブロック

`// ---- Entry IC: search input + pulldown ----` ブロックを次に置換（プルダウン分を除去）:

```js
  // ---- Entry IC: 検索入力のみ（チップはrefreshNearestSuggestionsが配線） ----
  const entryInput = document.getElementById('inp-entry-ic');
  function resolveEntryFromSearch() {
    const icId = icValueIndex.get(entryInput.value);
    if (!icId) {
      const hint = document.getElementById('entry-ic-hint');
      hint.textContent = entryInput.value ? '候補から選択してください' : '';
      hint.className = entryInput.value ? 'hint error' : 'hint';
      return;
    }
    setEntryIc(icId); update();
  }
  entryInput.addEventListener('change', resolveEntryFromSearch);
  entryInput.addEventListener('input',  resolveEntryFromSearch);
```

`// ---- Exit IC: favorites + ... ----` ブロックを次に置換（検索のみ＋編集モードで追加）:

```js
  // ---- Exit IC: 検索入力（編集モード中はお気に入りに追加） ----
  const exitInput = document.getElementById('inp-exit-ic');
  function resolveExitFromSearch() {
    const icId = icValueIndex.get(exitInput.value);
    if (!icId) {
      const hint = document.getElementById('exit-ic-hint');
      hint.textContent = exitInput.value ? '候補から選択してください' : '';
      hint.className = exitInput.value ? 'hint error' : 'hint';
      return;
    }
    if (exitEditMode) {
      exitFavorites = addFavorite(exitFavorites, icId);
      saveFavorites(exitFavorites);
    }
    setExitIc(icId); update();
  }
  exitInput.addEventListener('change', resolveExitFromSearch);
  exitInput.addEventListener('input',  resolveExitFromSearch);

  // ---- お気に入り編集トグル ----
  document.getElementById('btn-exit-edit').addEventListener('click', () => {
    exitEditMode = !exitEditMode;
    document.getElementById('btn-exit-edit').textContent = exitEditMode ? '✓ 完了' : '⚙ 編集';
    if (exitEditMode) document.getElementById('exit-search').open = false;
    renderExitFavorites();
  });
```

`btn-swap-ic`・保存ボタン（`btn-save-oneway`/`btn-save-roundtrip`/`btn-clear-log`）・geo ボタン・`sel-outer-route`/`chk-via-gaikan`/`sel-shutoko-route` のリスナはそのまま残す。

- [ ] **Step 8: 回帰テストが緑のままか確認**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`（456 tests）。ロジック不変なので変化なし。

- [ ] **Step 9: ブラウザで実描画を確認（静的サーバ）**

Run: `npm run serve`（別ターミナル）→ `http://localhost:8000/tools/ic.html` を Chrome で開く。
※購読ゲート(`enforceAccess('core')`)で `subscribe.html` にリダイレクトされる場合は、確認用に DevTools コンソールで `localStorage` のアクセス権限を満たすか、`access-control.js` のdev扱いを使う（既存のdev確認手順に従う）。
Expected: 入口チップ／出口お気に入りチップ／⚙編集／答えカード／ルート折りたたみが案A順で表示。コンソールエラーなし。

- [ ] **Step 10: コミット**

```bash
git add tools/js/app.js
git commit -m "feat(ic): 入口/出口をチップ化・お気に入りlocalStorage化・答えカード表示制御を配線"
```

---

## Task 4: CSS（チップ主役化・答えカード・編集モード）

**Files:**
- Modify: `tools/css/style.css`（末尾に追記）

- [ ] **Step 1: 既存 `.ic-select` 系の不要スタイル整理は行わず、末尾に新スタイルを追記**

`tools/css/style.css` の末尾に追記:

```css
/* === 案A: ステップ型レイアウト === */
.ic-step {
  padding: 12px 16px; background: var(--surface);
  border-bottom: 1px solid var(--border); display: grid; gap: 8px;
}
.step-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.step-title { font-size: 15px; font-weight: 700; color: var(--text); }
.step-title small { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }
.step-num { color: var(--self-ded); }
.ic-selected { font-size: 14px; color: var(--text); font-weight: 600; }

/* 入口GPSチップを主役サイズに */
#geo-suggest { padding: 2px 0; }
.geo-suggest-buttons .btn-geo-suggest { min-height: 40px; font-size: 15px; padding: 8px 14px; }
.btn-geo-suggest.sel {
  background: rgba(52,152,219,.30); border-color: var(--self-ded);
  color: #fff; font-weight: 700;
}

/* 検索折りたたみ */
.ic-search summary { cursor: pointer; font-size: 14px; color: var(--muted); padding: 4px 0; }
.ic-search[open] summary { color: var(--text); }
.ic-search .input-search { margin-top: 6px; width: 100%; }

/* 出口お気に入りチップ */
.fav-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.fav-chip {
  min-height: 40px; padding: 8px 14px; font-size: 15px;
  background: rgba(201,162,74,.14); color: var(--text);
  border: 1px solid rgba(201,162,74,.5); border-radius: 18px;
  display: inline-flex; align-items: center; gap: 6px;
}
.fav-chip .star { color: #c9a24a; }
.fav-chip.sel {
  background: rgba(46,204,113,.18); border-color: rgba(46,204,113,.65);
  color: #fff; font-weight: 700;
}
.fav-chip .chip-remove { color: #e74c3c; font-weight: 700; margin-left: 2px; }
.fav-chip.fav-add { background: transparent; border-style: dashed; color: var(--muted); }
.btn-edit-fav {
  min-height: 32px; padding: 4px 12px; font-size: 13px;
  background: var(--border); color: var(--text); border: none; border-radius: 6px;
}

/* 答えカード */
.answer-card { padding: 16px; }
.answer-placeholder {
  padding: 18px; text-align: center; color: var(--muted); font-size: 15px;
  background: var(--surface); border: 1px dashed var(--border); border-radius: 12px;
}
.answer-body {
  display: grid; gap: 10px; padding: 16px;
  background: #16243a; border: 2px solid var(--company); border-radius: 12px;
}
.answer-body .badge-main { font-size: 32px; }
.answer-body .save-buttons { display: flex; gap: 8px; margin-top: 4px; }
.answer-body .save-buttons button {
  flex: 1; min-height: 48px; font-size: 16px; font-weight: 700; border-radius: 8px;
}

/* ルート詳細の集約折りたたみ */
.route-detail-collapse > summary {
  cursor: pointer; font-size: 14px; color: var(--muted); padding: 6px 0;
}
.route-detail-collapse[open] > summary { color: var(--text); }
```

- [ ] **Step 2: ブラウザで見た目確認**

Run: 既存サーバで `tools/ic.html` をリロード。
Expected: チップが指で押せるサイズ、答えカードが緑枠で目立つ、編集モードで×と＋追加が出る。`レビュー/IC判定UI改善-3案比較-2026-05-22.html` の案Aに近い見た目。

- [ ] **Step 3: コミット**

```bash
git add tools/css/style.css
git commit -m "style(ic): 案Aのチップ・答えカード・編集モードのスタイル追加"
```

---

## Task 5: Service Worker キャッシュ更新

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: 新規JSをキャッシュ対象に追加**

`sw.js` の `STATIC_FILES` 配列内、`'./tools/js/airline-color.js',` の次の行に追加:

```js
  './tools/js/exit-favorites.js',
```

- [ ] **Step 2: CACHE_NAME を bump**

`sw.js` 2行目を変更:
```js
const CACHE_NAME = CACHE_PREFIX + 'v179';
```
↓
```js
const CACHE_NAME = CACHE_PREFIX + 'v180';
```

- [ ] **Step 3: コミット**

```bash
git add sw.js
git commit -m "chore(sw): exit-favorites.js をキャッシュ追加・CACHE_NAME v180"
```

---

## Task 6: 旧チケットclose・台帳更新（.company／git対象外）

**Files:**
- Modify: `.company/pm/tickets/2026-05-15-ic-route-jct-selector.md`
- Modify: `.company/secretary/active-sessions.md`

※`.company` は `タクシー乗務アプリ/` 直下でこのリポジトリの外。git commit ではなくファイル編集のみ（秘書の台帳管理）。

- [ ] **Step 1: 旧チケットを done に**

`.company/pm/tickets/2026-05-15-ic-route-jct-selector.md` の front-matter `status: open` を `status: done` に変更し、本文末尾に追記:

```markdown

## 完了メモ（2026-05-22）
IC判定UI改善（案A）に統合。ルート選択＝ルート候補ミニカード方式（既存 route-comparison）で
経由ルートの選択を実現。経由JCT明示指定UIは作らず、ルートカード選択で吸収。
spec: docs/superpowers/specs/2026-05-22-ic-judge-ui-redesign-design.md
```

- [ ] **Step 2: active-sessions 台帳に本セッション行を追記**

`.company/secretary/active-sessions.md` の「現在 Active なセッション」表に1行追加（Session ID `ic-judge-ui-redesign`、worktree `タクシー日報-wt-ic-ui`、branch `feat/ic-judge-ui-redesign`、担当 engineering/qa/pm、作業ファイル `tools/ic.html`/`tools/css/style.css`/`tools/js/app.js`/`tools/js/exit-favorites.js`/`tests/exit-favorites.test.js`/`sw.js`、Status 実装中）。

---

## Task 7: 最終回帰・dev反映（本人確認つき）

**Files:** なし（検証＋デプロイ）

- [ ] **Step 1: 全テスト**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`（456 tests）。

- [ ] **Step 2: 実機相当の手動確認チェックリスト**

dev反映後 iPhone（または dev プロファイルのChrome）で:
- [ ] GPS取得 → 近い順チップから入口選択（緑グロー・選択ハイライト）
- [ ] 出口お気に入りチップ選択／⚙編集で×削除・＋追加・空にできる（リロード後も保持）
- [ ] 入口・出口がそろうと答えカードが出て控除km（片道/往復）が正しい
- [ ] 片道/往復保存 → 今日のログと合計・走行可能距離に反映
- [ ] ルート候補が複数の時だけミニカード表示、選択で答え更新
- [ ] GPSオフ/拒否で検索が手動モードになる
- [ ] 旧データ（既存ユーザー）でも初期お気に入りが従来通り出る

- [ ] **Step 3: dev へ反映（本人承認後）**

```bash
git fetch dev
git rebase dev/main          # relayデータ等の進みを取り込む
npm test 2>&1 | tail -3      # rebase後も緑
git push dev feat/ic-judge-ui-redesign:main   # ※実際のdev反映手順は既存運用に合わせる
```
※dev/main への反映方法（直push か PR か）は既存のデプロイ運用に従う。GitHub Pages dev ビルド完了後、PWA再起動を本人に案内（SW v180）。

- [ ] **Step 4: 本人が dev 実機で承認 → 本番反映**

本番（origin）反映は既存の dev→prod フローに従う。本人承認が前提。

---

## Self-Review

**Spec coverage:**
- 画面構成（入口→出口→答え→ルート/詳細→ログ）→ Task 2 ✓
- 入力二重の解消（プルダウン廃止）→ Task 2（HTML）/ Task 3（JS：sel-* 削除）✓
- 入口GPSチップ主役 → Task 3 Step4 + Task 4 CSS ✓
- 出口編集可お気に入り（localStorage・seed・add/remove・空許容）→ Task 1 + Task 3 ✓
- 答えカード表示制御 → Task 3 Step6 + Task 4 ✓
- ルート詳細の折りたたみ集約 → Task 2 ✓
- 既存ロジック不変・回帰維持 → Task 3 Step8 / Task 7 ✓
- GPS無効フォールバック → 既存 onGeoState 流用（変更不要、Task 7で確認）✓
- SWキャッシュbump → Task 5 ✓
- 旧チケット統合close → Task 6 ✓
- スコープ外（履歴・精度改修・入口お気に入り）→ 計画に含めない ✓

**Placeholder scan:** プレースホルダなし。各stepに実コード/実コマンドあり。

**Type/識別子の一貫性:** `exitFavorites`/`exitEditMode`/`renderExitFavorites`/`initExitFavorites`/`renderIcSelected`/`markActiveEntryChip`/`refreshAnswerVisibility` は Task 3 内で定義・参照が一致。`EXIT_FAVORITES_KEY`/`loadFavorites`/`addFavorite`/`removeFavorite`/`saveFavorites` は Task 1 で定義し Task 3 で import。温存ID一覧と Task 2 のHTMLが一致。

**注意点:** `access-control.js` の購読ゲートにより `tools/ic.html` 直接表示は dev 確認手順が必要（Task 3 Step9に明記）。`setExitIc('kukou_chuou')` は空港中央がお気に入りに無くても選択表示は出る（チップは存在時のみハイライト）。

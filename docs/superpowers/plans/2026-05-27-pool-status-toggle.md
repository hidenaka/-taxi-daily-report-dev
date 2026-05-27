# タクシープール現況セクション トグル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `arrivals.html` の「🚕 タクシープール現況・出庫」セクション全体を、見出し横のボタンで表示/非表示できるようにする。状態は localStorage に保存し、次回起動時も維持する。

**Architecture:** `forecast-section` の中身を `<div id="forecast-body">` でラップし、h2 にトグルボタンを追加。`pool-status-section.js` に純関数 `getCollapsed`/`setCollapsed` と DOM 初期化関数 `initForecastSectionToggle` を追加。`arrivals-app.js` から起動時に呼び出す。SW CACHE_NAME bump で配信。

**Tech Stack:** vanilla JS module + localStorage + `hidden` 属性。Node.js `node --test`。

**設計書**: `~/work/taxi-dev-wt-pool-status/docs/superpowers/specs/2026-05-27-pool-status-toggle-design.md`

**作業環境:**
- `~/work/taxi-dev-wt-pool-status` branch `feat/pool-status`
- テスト: `cd ~/work/taxi-dev-wt-pool-status && npm test`
- push しない、dev反映は `PUSH-genkyo.sh`、本番は `v1.38.0` タグ

---

## File Structure

| ファイル | 変更内容 |
|---|---|
| `tools/js/pool-status-section.js` | `getCollapsed`/`setCollapsed`/`initForecastSectionToggle` を追加・export |
| `tools/js/arrivals-app.js` | `initForecastSectionToggle()` 呼び出し追加 |
| `tools/arrivals.html` | h2 内にトグルボタン、`<div id="forecast-body">` でラップ |
| `tests/pool-status-section.test.js` | localStorage純関数のテスト4件追加 |
| `sw.js` | CACHE_NAME bump |

---

### Task T1: 純関数 getCollapsed / setCollapsed を追加

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status-section.test.js` の import 行を次に置き換え:

```js
import { levelText, levelDots, activityText, isStale, waitText, trendText, formatStallLine, formatTerminalArrivals, formatActivityLine, formatStallLineV2, formatArrivalsList, getCollapsed, setCollapsed } from '../tools/js/pool-status-section.js';
```

ファイル末尾に追記:

```js
test('getCollapsed: localStorageに値なしならfalse', async () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('getCollapsed: "1" なら true', async () => {
  const store = new Map([['forecast-section-collapsed', '1']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), true);
});

test('getCollapsed: "0" は false', async () => {
  const store = new Map([['forecast-section-collapsed', '0']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('setCollapsed: true → "1" / false → "0" を保存', async () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  setCollapsed(true, storage);
  assert.equal(store.get('forecast-section-collapsed'), '1');
  setCollapsed(false, storage);
  assert.equal(store.get('forecast-section-collapsed'), '0');
});

test('setCollapsed/getCollapsed: ストレージ例外時はfalseに fallback', async () => {
  const storage = {
    getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('disabled'); },
  };
  // クラッシュしないことを確認
  setCollapsed(true, storage);
  assert.equal(getCollapsed(storage), false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — `getCollapsed is not a function`（import が undefined）

- [ ] **Step 3: 最小実装**

`tools/js/pool-status-section.js` の `isStale` 関数の直後に追記:

```js
const COLLAPSE_KEY = 'forecast-section-collapsed';

/** 折りたたみ状態を localStorage から読む。"1" なら true、他は false。例外時も false。 */
export function getCollapsed(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try { return storage.getItem(COLLAPSE_KEY) === '1'; }
  catch { return false; }
}

/** 折りたたみ状態を localStorage へ書く。true→"1"/false→"0"。例外は無視。 */
export function setCollapsed(value, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(COLLAPSE_KEY, value ? '1' : '0'); }
  catch { /* ストレージ無効時は無視 */ }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（既存テスト + 新4件すべて緑）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): 折りたたみ状態 getCollapsed/setCollapsed 純関数追加"
```

---

### Task T2: initForecastSectionToggle + HTML編集 + arrivals-app 呼び出し

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`（initForecastSectionToggle追加）
- Modify: `~/work/taxi-dev-wt-pool-status/tools/arrivals.html`（h2にボタン+wrapper div）
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/arrivals-app.js`（import + 呼び出し）

> このタスクはDOM操作なので単体テスト対象外。実装→構文確認→手動smoke で進める。

- [ ] **Step 1: initForecastSectionToggle を pool-status-section.js に追加**

`tools/js/pool-status-section.js` の `setCollapsed` 関数の直後に追記:

```js
/** トグルボタンを初期化。クリックで forecast-body の hidden 属性と localStorage を更新。 */
export function initForecastSectionToggle() {
  const btn = document.getElementById('forecast-section-toggle');
  const body = document.getElementById('forecast-body');
  if (!btn || !body) return;
  const apply = (collapsed) => {
    body.hidden = collapsed;
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = collapsed ? '▶ 展開' : '▼ 折りたたみ';
  };
  apply(getCollapsed());
  btn.addEventListener('click', () => {
    const next = !getCollapsed();
    setCollapsed(next);
    apply(next);
  });
}
```

- [ ] **Step 2: arrivals.html のh2にトグルボタン挿入＋forecast-body でラップ**

`tools/arrivals.html` 229行目の h2 行を次に置き換える:

```html
    <h2>🚕 タクシープール現況・出庫<button id="forecast-section-toggle" type="button" aria-expanded="true" aria-controls="forecast-body" style="background:transparent; border:none; color:var(--sub); cursor:pointer; font-size:13px; margin-left:8px;">▼ 折りたたみ</button><button class="help-video-btn" data-help-video="arrivals" type="button">▶ 使い方（15秒）</button></h2>
```

> 既存 `<button class="help-video-btn" ...>` の **前**に `forecast-section-toggle` ボタンを挿入する。

次に、`<div class="help-video" id="help-video-arrivals"></div>` の直後（230行目以降）から、`</section>` の直前まで全体を `<div id="forecast-body">` で包む。

230行目 `<div class="help-video" id="help-video-arrivals"></div>` の**直後**に追加:

```html
    <div id="forecast-body">
```

そして `</section>` の直前に `</div>` を追加（既存 forecast-section 末尾構造を確認のうえ）。

具体的に、現状:

```html
    <h2>🚕 タクシープール現況・出庫<button class="help-video-btn" ...>...</button></h2>
    <div class="help-video" id="help-video-arrivals"></div>
    <div id="pool-status-block" ...>...
    ...
    [forecast-empty 等の中身]
    ...
  </section>
```

変更後:

```html
    <h2>🚕 タクシープール現況・出庫<button id="forecast-section-toggle" ...>▼ 折りたたみ</button><button class="help-video-btn" ...>...</button></h2>
    <div class="help-video" id="help-video-arrivals"></div>
    <div id="forecast-body">
      <div id="pool-status-block" ...>...
      ...
      [forecast-empty 等の中身]
      ...
    </div>
  </section>
```

- [ ] **Step 3: arrivals-app.js から initForecastSectionToggle 呼び出し**

`tools/js/arrivals-app.js` の現状 import 行（pool-status-section.js から `initPoolStatusSection` を import している箇所）を次に置き換える:

```js
import { initPoolStatusSection, initForecastSectionToggle } from './pool-status-section.js';
```

そして、`initPoolStatusSection().then(...)` の**直前**（または直後でも可）に1行追加:

```js
initForecastSectionToggle();
initPoolStatusSection().then(fn => { if (fn) refreshPoolStatus = fn; });
```

- [ ] **Step 4: HTML 構造健全性チェック**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && node -e "const h=require('fs').readFileSync('tools/arrivals.html','utf8'); const o=(h.match(/<div/g)||[]).length, c=(h.match(/<\/div>/g)||[]).length; console.log('div open',o,'close',c);"
```
Expected: open と close の数が一致（変更前と差: +1 open / +1 close = ±0）。

- [ ] **Step 5: テスト実行**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（既存テスト + Task T1のテスト全件緑。新規 DOM 関数 `initForecastSectionToggle` はテスト対象外）

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tools/arrivals.html tools/js/arrivals-app.js
git commit -m "feat(pool-status): 現況セクションを見出しボタンで折りたたみ可能に"
```

---

### Task T3: SW CACHE_NAME bump

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/sw.js`

- [ ] **Step 1: dev最新 CACHE_NAME を確認**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main && echo "現状: $(grep '^const CACHE_NAME' sw.js)" && echo "dev最新: $(git show origin/main:sw.js | grep '^const CACHE_NAME')"
```

- [ ] **Step 2: sw.js bump（dev最新+1）**

`sw.js` 2行目を **dev最新+1** に書き換える（例: dev最新がv232なら v233）:

```js
const CACHE_NAME = CACHE_PREFIX + 'v233';
```

- [ ] **Step 3: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add sw.js
git commit -m "chore(sw): CACHE_NAME bump（現況セクション折りたたみ）"
```

---

### Task T4: dev反映＋本番タグ

> Claudeが実行可（前回までの権限延長）

- [ ] **Step 1: dev反映**

```bash
bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh
```

衝突したら sw.js を dev最新+1 に統一、`git rebase --continue`。

- [ ] **Step 2: dev確認（ユーザー目視）**

dev URL の `arrivals.html` を PWA再起動して開き、

- 「🚕 タクシープール現況・出庫 [▼ 折りたたみ]」ボタンが見える
- クリックで section 中身が消える
- ボタンが「[▶ 展開]」に変わる
- リロードしても折りたたみ状態が維持される
- もう一度クリックすると展開される

を確認。

- [ ] **Step 3: 本番タグ v1.38.0**

```bash
cd ~/work/taxi-dev && git fetch -q origin main && git tag v1.38.0 origin/main && git push origin v1.38.0
```

deploy.yml が自動で本番にrsync。

- [ ] **Step 4: 本番反映確認**

```bash
sleep 60
cd ~/work/taxi-dev && git fetch -q prod main
echo "prod/main: $(git rev-parse prod/main | cut -c1-8)"
git show prod/main:tools/arrivals.html | grep -c "forecast-section-toggle"
git show prod/main:sw.js | grep "^const CACHE_NAME"
```
Expected: prod/main が deploy commit に進み、`forecast-section-toggle` がマッチ、sw.js が新版数になっている。

---

## Self-Review

**1. Spec coverage**
- ✅ section全体トグル（h2を除く全コンテンツ） → T2 Step2 で `<div id="forecast-body">` ラップ
- ✅ help-video は body の外（折りたたみ中も動画再生可能） → T2 Step2 で help-video の**後**に forecast-body 開始
- ✅ localStorage 保存 → T1 `setCollapsed`
- ✅ 初回「表示」 → T1 `getCollapsed` が値なしで false返却 = 展開
- ✅ aria-expanded → T2 Step1 `apply()` で setAttribute
- ✅ SW bump → T3
- ✅ dev反映＋本番タグ → T4

**2. Placeholder scan**: 無し。各ステップに具体的コードとコマンド。

**3. Type consistency**
- `COLLAPSE_KEY = 'forecast-section-collapsed'` を T1で定義、テストも同じ文字列を期待 ✓
- `getCollapsed/setCollapsed` 引数 `storage` のシグネチャ一貫 ✓
- HTML id `forecast-section-toggle` / `forecast-body` を T2 全Stepで統一 ✓
- `aria-expanded` の初期値 `"true"` （展開） = T2 Step2 HTML と T2 Step1 apply 初期適用 で整合 ✓

---

## 実行方法

`superpowers:subagent-driven-development`（タスクごと新サブエージェント＋段階レビュー、推奨）。Task T1〜T3 は1人の implementer が連続TDD、T4 は Claude が直接実行。

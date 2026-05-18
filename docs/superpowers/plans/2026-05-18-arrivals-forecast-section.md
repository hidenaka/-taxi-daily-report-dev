# 到着便ページへのタクシー出庫予測の組み込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の到着便ページ `tools/arrivals.html` の上部に、taxi-ic-helper の `forecast.html` から移植したタクシー出庫予測（統合予測＋内訳＋類似日マッチング）を常時表示セクションとして組み込む。

**Architecture:** taxi-ic-helper が GitHub にコミット済みの予測データ JSON 3種を既存の同期ワークフロー経由で `tools/data/` に取り込み、`forecast.html` の描画ロジック（`forecast-render.js`）を複製、薄いローダー `forecast-section.js` で 3 JSON を読み込んで描画する。`arrivals-app.js` がページ読み込み時にローダーを1回呼ぶ。変更は `taxi-daily-report` リポジトリのみ。

**Tech Stack:** バニラ JS（ES Modules）、`node --test`（テストランナーは `tests/run.js` 経由）、GitHub Actions（同期ワークフロー）、Service Worker（PWA キャッシュ）。

**作業ブランチ/worktree:** `feat/arrivals-forecast-section` / `タクシー日報-wt-forecast/`（設定済み）。spec: `docs/superpowers/specs/2026-05-18-arrivals-forecast-section-design.md`。

---

## ファイル構成

| ファイル | 区分 | 責務 |
|---|---|---|
| `tools/js/forecast-render.js` | 新規（複製） | 予測データを DOM に描画する純粋関数群。taxi-ic-helper から無改変で複製。 |
| `tools/js/forecast-section.js` | 新規 | 予測 JSON 3種の取得（`loadForecastData`）と描画呼び出し（`initForecastSection`）。 |
| `tools/data/stall-ensemble.json` | 新規（初回スナップショット） | 統合予測データ。以降は同期ワークフローが更新。 |
| `tools/data/stall-forecast.json` | 新規（初回スナップショット） | 短期予測データ。同上。 |
| `tools/data/stall-pattern-match.json` | 新規（初回スナップショット） | 類似日マッチングデータ。同上。 |
| `tests/forecast-section.test.js` | 新規 | `loadForecastData` のユニットテスト。 |
| `tools/arrivals.html` | 変更 | 予測セクションのマークアップ＋CSS、`:root` に CSS 変数追加。 |
| `tools/js/arrivals-app.js` | 変更 | `initForecastSection()` を import し読み込み時に呼ぶ。 |
| `.github/workflows/sync-arrivals.yml` | 変更 | 同期対象を 4 ファイルに拡張。 |
| `sw.js` | 変更 | `CACHE_NAME` のバージョンを上げる。 |

---

## Task 1: forecast-render.js の複製と予測データの初回スナップショット配置

**Files:**
- Create: `tools/js/forecast-render.js`（`../乗務地図関係/js/forecast-render.js` を無改変で複製）
- Create: `tools/data/stall-ensemble.json` / `tools/data/stall-forecast.json` / `tools/data/stall-pattern-match.json`

`forecast-render.js` は taxi-ic-helper 側で既存テスト済みのため、無改変で複製する。未使用の `renderAccuracy` / `renderCorrections` も含むが、上流との差分を最小化するため削除しない。

- [ ] **Step 1: ファイルを複製**

worktree ルート（`タクシー日報-wt-forecast/`）で実行する:

```bash
cp "../乗務地図関係/js/forecast-render.js" tools/js/forecast-render.js
cp "../乗務地図関係/data/stall-ensemble.json" tools/data/stall-ensemble.json
cp "../乗務地図関係/data/stall-forecast.json" tools/data/stall-forecast.json
cp "../乗務地図関係/data/stall-pattern-match.json" tools/data/stall-pattern-match.json
```

- [ ] **Step 2: 複製を確認**

Run: `head -6 tools/js/forecast-render.js && ls -la tools/data/stall-*.json`
Expected: `forecast-render.js` の先頭に `export function renderForecastMeta` 等が見える。3 つの JSON が存在し、サイズが 0 でない。

- [ ] **Step 3: コミット**

```bash
git add tools/js/forecast-render.js tools/data/stall-ensemble.json tools/data/stall-forecast.json tools/data/stall-pattern-match.json
git commit -m "feat(forecast): forecast-render.js と予測データを taxi-ic-helper から複製"
```

---

## Task 2: forecast-section.js の loadForecastData（TDD）

**Files:**
- Create: `tools/js/forecast-section.js`
- Test: `tests/forecast-section.test.js`

`loadForecastData(fetchFn)` は 3 つの予測 JSON を取得して `{ ensemble, forecast, patternMatch, errors }` を返す純粋関数。各取得は独立した try/catch で、1 つ失敗しても他は継続し、失敗は例外を投げず `errors` に記録する。`fetchFn` を引数化してテストでスタブ可能にする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/forecast-section.test.js` を作成:

```js
import { test, assert } from './run.js';
import { loadForecastData } from '../tools/js/forecast-section.js';

// path -> { body } | { status } のマップで fetch をスタブする
function stubFetch(map) {
  return async (path) => {
    const entry = map[path];
    if (!entry) throw new Error('network error');
    if (entry.status && entry.status !== 200) return { ok: false, status: entry.status };
    return { ok: true, status: 200, json: async () => entry.body };
  };
}

test('loadForecastData: 3種すべて成功で全データを返す', async () => {
  const fetchFn = stubFetch({
    'data/stall-ensemble.json': { body: { a: 1 } },
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.deepEqual(r.ensemble, { a: 1 });
  assert.deepEqual(r.forecast, { b: 2 });
  assert.deepEqual(r.patternMatch, { c: 3 });
  assert.deepEqual(r.errors, {});
});

test('loadForecastData: 404 は errors に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({
    'data/stall-ensemble.json': { status: 404 },
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.equal(r.ensemble, null);
  assert.equal(r.errors.ensemble, 'HTTP 404');
  assert.deepEqual(r.forecast, { b: 2 });
});

test('loadForecastData: fetch 例外も errors に記録し他は継続', async () => {
  const fetchFn = stubFetch({
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.equal(r.ensemble, null);
  assert.equal(r.errors.ensemble, 'network error');
  assert.deepEqual(r.forecast, { b: 2 });
  assert.deepEqual(r.patternMatch, { c: 3 });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `node --test tests/forecast-section.test.js`
Expected: FAIL（`forecast-section.js` が存在せず import エラー、または `loadForecastData` が未定義）。

- [ ] **Step 3: forecast-section.js を実装（loadForecastData まで）**

`tools/js/forecast-section.js` を作成:

```js
import {
  renderEnsemble, renderThroughputBanner,
  renderForecastMeta, renderForecastTable,
  renderPatternMeta, renderSimilarDays, renderHistoricalCurve,
} from './forecast-render.js';

const SOURCES = [
  { key: 'ensemble', path: 'data/stall-ensemble.json' },
  { key: 'forecast', path: 'data/stall-forecast.json' },
  { key: 'patternMatch', path: 'data/stall-pattern-match.json' },
];

// 予測 JSON 3種を取得する。各取得は独立。失敗は errors に記録し例外を投げない。
export async function loadForecastData(fetchFn = fetch) {
  const result = { ensemble: null, forecast: null, patternMatch: null, errors: {} };
  for (const { key, path } of SOURCES) {
    try {
      const res = await fetchFn(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result[key] = await res.json();
    } catch (e) {
      result.errors[key] = e.message;
    }
  }
  return result;
}
```

- [ ] **Step 4: テストを実行し成功を確認**

Run: `node --test tests/forecast-section.test.js`
Expected: PASS（3 テストすべて）。

- [ ] **Step 5: コミット**

```bash
git add tools/js/forecast-section.js tests/forecast-section.test.js
git commit -m "feat(forecast): 予測データローダー loadForecastData を追加"
```

---

## Task 3: forecast-section.js の initForecastSection（DOM 描画）

**Files:**
- Modify: `tools/js/forecast-section.js`

`initForecastSection()` は `loadForecastData()` を呼び、結果を `arrivals.html` 内の DOM 要素に描画する。DOM 描画のグルーコードはこのプロジェクトの既存方針（`arrivals-render.js` 等にユニットテスト無し）に合わせ、テストは追加しない。検証は Task 8 の dev 動作確認で行う。

- [ ] **Step 1: forecast-section.js に initForecastSection を追記**

`tools/js/forecast-section.js` の末尾（`loadForecastData` の後）に追加:

```js
// arrivals.html 内の予測セクションを描画する。
// 各データは独立して描画/エラー表示する（1つの失敗が他をブロックしない）。
export async function initForecastSection() {
  const data = await loadForecastData();

  const ensembleMetaEl = document.getElementById('ensemble-meta');
  const ensembleTableEl = document.getElementById('ensemble-table-wrap');
  const bannerEl = document.getElementById('throughput-banner');
  if (data.ensemble) {
    renderEnsemble(ensembleMetaEl, ensembleTableEl, data.ensemble);
    renderThroughputBanner(bannerEl, data.ensemble);
  } else {
    ensembleMetaEl.textContent = `統合予測データの読み込みに失敗: ${data.errors.ensemble}`;
    ensembleTableEl.innerHTML = '';
  }

  const metaEl = document.getElementById('forecast-meta');
  const tableEl = document.getElementById('forecast-table-wrap');
  if (data.forecast) {
    renderForecastMeta(metaEl, data.forecast);
    renderForecastTable(tableEl, data.forecast);
  } else {
    metaEl.textContent = `予測データの読み込みに失敗: ${data.errors.forecast}`;
    tableEl.innerHTML = '';
  }

  const patternMetaEl = document.getElementById('pattern-meta');
  const similarDaysEl = document.getElementById('similar-days');
  const curveEl = document.getElementById('historical-curve-wrap');
  if (data.patternMatch) {
    renderPatternMeta(patternMetaEl, data.patternMatch);
    renderSimilarDays(similarDaysEl, data.patternMatch);
    renderHistoricalCurve(curveEl, data.patternMatch);
  } else {
    patternMetaEl.textContent = `類似日マッチングデータの読み込みに失敗: ${data.errors.patternMatch}`;
    similarDaysEl.innerHTML = '';
    curveEl.innerHTML = '';
  }
}
```

- [ ] **Step 2: 既存テストが壊れていないか確認**

Run: `node --test tests/forecast-section.test.js`
Expected: PASS（Task 2 の 3 テストが引き続き成功。`initForecastSection` はモジュールロード時に実行されないため Node でも import 可能）。

- [ ] **Step 3: コミット**

```bash
git add tools/js/forecast-section.js
git commit -m "feat(forecast): initForecastSection で予測セクションを描画"
```

---

## Task 4: arrivals.html に予測セクションのマークアップと CSS を追加

**Files:**
- Modify: `tools/arrivals.html`

3 箇所を変更する: (A) `:root` に CSS 変数 2 個追加、(B) `<style>` に予測セクション用 CSS 追加、(C) バナー直下に予測セクションのマークアップ追加。

- [ ] **Step 1: `:root` に CSS 変数を追加**

`tools/arrivals.html` の `:root` 行（現状）:

```css
    :root { --bg: #0e0e10; --fg: #e8e8e8; --sub: #888; --accent: #4ea1ff; --peak: #ff5252; --warn: #ffb84d; --intl: #b07aff; --taxi: #6ec96e; }
```

を、以下に置き換える（`--high` / `--very-high` を追加。`forecast-render.js` が出力する `.star` 等が使用）:

```css
    :root { --bg: #0e0e10; --fg: #e8e8e8; --sub: #888; --accent: #4ea1ff; --peak: #ff5252; --warn: #ffb84d; --intl: #b07aff; --taxi: #6ec96e; --high: #ffb84d; --very-high: #ff5252; }
```

- [ ] **Step 2: 予測セクション用 CSS を追加**

`tools/arrivals.html` の `<style>` ブロック内、`#arrivals-error { ... }` の行（スタイル定義の最後）の直後に、以下を追加する:

```css
    .throughput-banner { font-size: 13px; padding: 8px 10px; border-radius: 6px; margin-bottom: 12px; }
    .throughput-banner.calibrated { background: rgba(78, 161, 255, 0.12); color: var(--accent); }
    .throughput-banner.pending { background: #16161c; color: var(--sub); }
    .ensemble-section { margin-bottom: 24px; }
    .ensemble-section h2 { font-size: 17px; margin: 0 0 8px 0; color: var(--accent); }
    .ensemble-meta { color: var(--sub); font-size: 12px; margin-bottom: 12px; line-height: 1.5; }
    .ensemble-table { border-collapse: collapse; width: 100%; }
    .ensemble-table th, .ensemble-table td { padding: 6px 8px; border-bottom: 1px solid #222; text-align: right; font-variant-numeric: tabular-nums; }
    .ensemble-table th { background: #16161c; color: var(--sub); font-weight: 500; font-size: 12px; }
    .ensemble-table td.time { text-align: left; font-weight: 600; }
    .ensemble-table tr.tier-high td { background: rgba(255, 184, 77, 0.10); }
    .ensemble-table tr.tier-very-high td { background: rgba(255, 82, 82, 0.14); }
    .forecast-meta { margin: 8px 0 16px 0; color: var(--sub); font-size: 13px; line-height: 1.5; }
    .forecast-table { border-collapse: collapse; width: 100%; }
    .forecast-table th, .forecast-table td { padding: 6px 8px; border-bottom: 1px solid #222; text-align: right; font-variant-numeric: tabular-nums; }
    .forecast-table th { background: #16161c; color: var(--sub); font-weight: 500; font-size: 12px; }
    .forecast-table td.time { text-align: left; font-weight: 600; }
    .forecast-table tr.tier-high td { background: rgba(255, 184, 77, 0.10); }
    .forecast-table tr.tier-very-high td { background: rgba(255, 82, 82, 0.14); }
    .star { color: var(--very-high); font-weight: 700; }
    .factor-cell { color: var(--sub); font-size: 12px; }
    .total-cell { font-weight: 700; }
    .pattern-section { margin-top: 32px; padding-top: 16px; border-top: 1px solid #222; }
    .pattern-section h2 { font-size: 16px; margin: 0 0 8px 0; }
    .pattern-section h3 { font-size: 14px; margin: 16px 0 8px 0; color: var(--sub); }
    .pattern-meta { color: var(--sub); font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
    .similar-day-list { list-style: none; padding: 0; margin: 0 0 16px 0; }
    .similar-day-item { padding: 6px 8px; border-bottom: 1px solid #222; display: flex; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
    .similar-day-icon { font-size: 14px; }
    .similar-day-label { flex: 1; }
    .similar-day-score { color: var(--sub); font-size: 12px; }
    .src-learning { color: var(--accent); }
    .src-fallback { color: var(--sub); }
    #forecast-section { border-bottom: 1px solid #222; }
```

- [ ] **Step 3: 予測セクションのマークアップを追加**

`tools/arrivals.html` の `<div id="stale-banner" hidden></div>` の行の直後（`<div id="topics" hidden></div>` の前）に、以下を挿入する:

```html

  <section id="forecast-section">
    <h2 style="font-size:15px;color:var(--fg);margin:14px 0 4px;">🚕 タクシー出庫予測</h2>
    <div id="throughput-banner" class="throughput-banner"></div>
    <section class="ensemble-section" id="ensemble-section">
      <h2>統合予測 (今後 2 時間)</h2>
      <div id="ensemble-meta" class="ensemble-meta">読み込み中...</div>
      <div id="ensemble-table-wrap"></div>
    </section>

    <h2 style="font-size:15px;margin:24px 0 8px;color:var(--sub);">内訳: 短期予測 (ルールベース)</h2>
    <div id="forecast-meta" class="forecast-meta">読み込み中...</div>
    <div id="forecast-table-wrap"></div>

    <section class="pattern-section" id="pattern-section">
      <h2>類似日マッチング</h2>
      <div id="pattern-meta" class="pattern-meta">読み込み中...</div>
      <ul id="similar-days" class="similar-day-list"></ul>
      <h3>ヒストリカル予測 (類似日平均)</h3>
      <div id="historical-curve-wrap"></div>
    </section>
  </section>
```

注: `arrivals.html` はグローバルに `section { padding: 8px 12px; }` を持つため、ネストした `.ensemble-section` / `.pattern-section` にも左右パディングが乗る。Task 8 の dev 目視確認でインデントが過剰でないか確認し、過剰なら `#forecast-section .ensemble-section, #forecast-section .pattern-section { padding-left: 0; padding-right: 0; }` を Step 2 の CSS に追記する。

- [ ] **Step 4: HTML 構文を確認**

Run: `node -e "const h=require('fs').readFileSync('tools/arrivals.html','utf8'); const o=(h.match(/<section/g)||[]).length, c=(h.match(/<\/section>/g)||[]).length; if(o!==c) throw new Error('section tag mismatch: '+o+' vs '+c); console.log('section tags balanced:', o);"`
Expected: `section tags balanced: 5`（既存 2 + 新規 3〔`#forecast-section`・`.ensemble-section`・`.pattern-section`〕。開閉が一致）。

- [ ] **Step 5: コミット**

```bash
git add tools/arrivals.html
git commit -m "feat(forecast): 到着便ページに予測セクションのマークアップとCSSを追加"
```

---

## Task 5: arrivals-app.js から initForecastSection を呼ぶ

**Files:**
- Modify: `tools/js/arrivals-app.js`

- [ ] **Step 1: import を追加**

`tools/js/arrivals-app.js` の 2 行目（`import { renderHeatmap, ... } from './arrivals-render.js';`）の直後に、以下の行を追加する:

```js
import { initForecastSection } from './forecast-section.js';
```

- [ ] **Step 2: 読み込み時に1回呼ぶ**

`tools/js/arrivals-app.js` の末尾、`refresh();` の行の直後（`setInterval(refresh, 60000);` の前）に、以下の行を追加する:

```js
initForecastSection();
```

予測は「今後2時間」の見通しで、データ同期も15分間隔のため、`arrivals` 本体のような 60 秒ごとの自動更新はしない（`forecast.html` 本体も 1 回描画のみ）。

- [ ] **Step 3: 既存テストの回帰確認**

Run: `npm test`
Expected: PASS（全テストファイル。`arrivals-app.js` はブラウザ用エントリでテスト対象外、import 追加で他テストが壊れないことを確認）。

- [ ] **Step 4: コミット**

```bash
git add tools/js/arrivals-app.js
git commit -m "feat(forecast): arrivals-app から予測セクションを初期化"
```

---

## Task 6: sync-arrivals.yml を予測データ3種の同期に拡張

**Files:**
- Modify: `.github/workflows/sync-arrivals.yml`

`arrivals.json` のみコピーしていたワークフローを、予測 JSON 3 種も含む 4 ファイル同期に拡張する。

- [ ] **Step 1: ワークフローファイルを書き換える**

`.github/workflows/sync-arrivals.yml` の内容を、以下で全置換する:

```yaml
name: Sync Arrivals & Forecast from taxi-ic-helper

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout this repo
        uses: actions/checkout@v4
        with:
          path: dest

      - name: Checkout taxi-ic-helper (data source)
        uses: actions/checkout@v4
        with:
          repository: hidenaka/taxi-ic-helper
          path: src

      - name: Copy data files
        run: |
          mkdir -p dest/tools/data
          for f in arrivals.json stall-ensemble.json stall-forecast.json stall-pattern-match.json; do
            cp "src/data/$f" "dest/tools/data/$f"
          done

      - name: Commit if changed
        working-directory: dest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          FILES="tools/data/arrivals.json tools/data/stall-ensemble.json tools/data/stall-forecast.json tools/data/stall-pattern-match.json"
          for i in 1 2 3; do
            if [ -z "$(git status --porcelain $FILES)" ]; then
              echo "No change. Skipping commit."
              exit 0
            fi
            git add $FILES
            git commit -m "chore(data): sync from taxi-ic-helper $(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M JST')" || true
            if git push; then
              exit 0
            fi
            echo "push failed (attempt $i): refresh and re-copy"
            git fetch origin main
            git reset --hard origin/main
            for f in arrivals.json stall-ensemble.json stall-forecast.json stall-pattern-match.json; do
              cp "../src/data/$f" "tools/data/$f"
            done
            sleep $((i * 3))
          done
          echo "push failed after 3 retries"
          exit 1
```

- [ ] **Step 2: YAML 構文を確認**

Run: `node -e "const fs=require('fs'); const t=fs.readFileSync('.github/workflows/sync-arrivals.yml','utf8'); if(!t.includes('stall-ensemble.json')||!t.includes('stall-pattern-match.json')) throw new Error('forecast files missing'); console.log('ok: 4-file sync');"`
Expected: `ok: 4-file sync`

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/sync-arrivals.yml
git commit -m "feat(forecast): 同期ワークフローを予測データ3種に拡張"
```

---

## Task 7: sw.js のキャッシュバージョン更新

**Files:**
- Modify: `sw.js`

`arrivals.html` は `STATIC_FILES`（プリキャッシュ対象）に含まれる。内容を変更したため、`CACHE_NAME` のバージョンを上げて全端末に再キャッシュさせる。

- [ ] **Step 1: 現在のバージョンを確認**

Run: `grep -n "CACHE_NAME" sw.js | head -1`
Expected: `const CACHE_NAME = 'taxi-daily-vNNN';` の形（`NNN` は現在の番号）。

- [ ] **Step 2: バージョンを +1 する**

`sw.js` 1 行目の `CACHE_NAME` の番号を現在値 +1 に変更する。例: `taxi-daily-v138` なら `taxi-daily-v139`。

補足: `STATIC_FILES` に `./tools/js/` 配下のモジュールが列挙されているか確認する。列挙されていれば（cache-first 方式）、同じ並びに `'./tools/js/forecast-render.js',` と `'./tools/js/forecast-section.js',` を追加する。列挙されていなければ（`./js/` 配下のみ）追加不要 — 既存の `tools/js/arrivals-*.js` と同じ扱いにする。

- [ ] **Step 3: 変更を確認**

Run: `grep -n "CACHE_NAME" sw.js | head -1`
Expected: バージョン番号が 1 増えている。

- [ ] **Step 4: コミット**

```bash
git add sw.js
git commit -m "chore(sw): 予測セクション追加に伴いキャッシュ版数を更新"
```

---

## Task 8: 全テスト回帰確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: 全テストファイルが PASS。`tests/forecast-section.test.js` の 3 テストを含む。失敗があれば原因を特定して修正し、該当タスクの該当ステップに戻る。

- [ ] **Step 2: dev 動作確認の準備が整ったことを確認**

Run: `git log --oneline origin/main..HEAD`
Expected: Task 1〜7 のコミット（design spec コミット含めて 8 件程度）がブランチに乗っている。

---

## デプロイ（plan 完了後・ユーザー操作）

本 plan のタスク完了後、既存の dev → 本番フローでデプロイする（plan のタスク範囲外）:

1. `feat/arrivals-forecast-section` を `dev` リモートへ push。
2. ⚠️ dev/main の `sw.js` は他セッションの cache-first 版の可能性あり。push 前に `git fetch dev && git rebase dev/main` で取り込み、`sw.js` の `CACHE_NAME` を dev 側の最新番号 +1 に取り直す。コンフリクトは `sw.js` / `tools/data/*.json` で起きうる。
3. dev 環境でユーザーが到着便ページを開き、予測セクションが上部に表示されることを目視確認（Task 4 Step 3 のパディング確認を含む）。
4. ユーザー承認後、該当コミットを `origin/main` へ反映。
5. `.company/secretary/active-sessions.md` の本セッション行の Status を更新。

---

## Self-Review

**Spec coverage:**
- 予測セクション1〜3の移植 → Task 1（render複製）/ Task 3（描画）/ Task 4（マークアップ）。✓
- セクション4・5を載せない → Task 3 で `renderAccuracy`/`renderCorrections` を呼ばない。✓
- データ同期（3 JSON を sync-arrivals.yml 拡張）→ Task 6。初回スナップショット → Task 1。✓
- `forecast-render.js` 複製 → Task 1。`forecast-section.js` 新規 → Task 2/3。`arrivals-app.js` 追記 → Task 5。✓
- 配置（バナー直下・ヒートマップ上）→ Task 4 Step 3。✓
- CSS 変数 `--high`/`--very-high` 追加 → Task 4 Step 1。✓
- アクセス制御は既存 `enforceAccess('core')` を継承 → 追加作業なし（spec 通り）。✓
- `sw.js` 版数更新 → Task 7。✓
- テスト（forecast-section の軽量テスト＋回帰）→ Task 2 / Task 8。✓
- 描画の独立性（1つの失敗が他をブロックしない）→ Task 2（`loadForecastData` 独立 try/catch）/ Task 3（データ別の if 分岐）。✓

**Placeholder scan:** プレースホルダなし。各コードステップに完全なコード/コマンドを記載。

**Type consistency:** `loadForecastData` の戻り値 `{ ensemble, forecast, patternMatch, errors }` を Task 2 で定義し Task 3 で同じプロパティ名で参照。`forecast-render.js` の関数名（`renderEnsemble` / `renderThroughputBanner` / `renderForecastMeta` / `renderForecastTable` / `renderPatternMeta` / `renderSimilarDays` / `renderHistoricalCurve`）は import と呼び出しで一致。DOM 要素 ID（`ensemble-meta` / `ensemble-table-wrap` / `throughput-banner` / `forecast-meta` / `forecast-table-wrap` / `pattern-meta` / `similar-days` / `historical-curve-wrap`）は Task 3 の `getElementById` と Task 4 のマークアップで一致。✓

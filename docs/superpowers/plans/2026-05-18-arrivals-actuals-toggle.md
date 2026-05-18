# 到着便ページ 出庫実績表示＋予測切替 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 到着便ページの予測セクションに「直近2時間の実出庫（実績）」を既定表示し、プルダウンで予測表示に切り替えられるようにする。

**Architecture:** taxi-ic-helper が新出力 `stall-actuals.json`（トラッカー実測出庫の15分集計）を生成 → relay が dev/prod へ配信 → 日報アプリの予測セクションにプルダウンを追加。3パート（taxi-ic-helper / relay / 日報アプリ）。

**Tech Stack:** Node.js ESM（`.mjs`/`.js`）。taxi-ic-helper のテストは `node:test`、日報アプリのテストは独自ランナー `tests/run.js`。

設計書: `docs/superpowers/specs/2026-05-18-arrivals-actuals-toggle-design.md`

## 前提知識（リポジトリ固有）

- **2リポジトリにまたがる**:
  - taxi-ic-helper（ローカル `乗務地図関係/`、GitHub `hidenaka/taxi-ic-helper`）= Task 1-2。main 直 push。テストは `npm test`（node:test）。
  - 日報アプリ（ローカル `タクシー日報-wt-actuals/` worktree、branch `feat/arrivals-actuals-toggle` → `dev/main`）= Task 3-4。テストは `npm test`。
- taxi-ic-helper commit メッセージ末尾に `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`。commit 前に `git diff --cached --name-only` で `data/` 混入なし確認。
- 日報アプリの commit も同じ Co-Authored-By 行。dev へ push（`git push dev feat/arrivals-actuals-toggle:main`）。本番反映はユーザー確認後（この計画には含めない）。
- `trackRowDeparted(row)` は `taxi-ic-helper/scripts/lib/throughput-calibration.mjs` 内の関数で、track 行の `cameras[*].departed`（数値のみ）を合算する。現状 export されていない。
- `vehicle-track-history.jsonl` の各行: `{schema_version, ts, cameras:{...}, ...}`。`ts` は JST ISO 文字列。
- 日報アプリの予測セクション: `tools/js/forecast-section.js`（`initForecastSection` が `#forecast-meta`/`#forecast-table-wrap` に描画）、`tools/arrivals.html`（`#forecast-section`）、`tools/js/arrivals-app.js`（`initForecastSection()` を呼ぶ）。

## ファイル構成

| ファイル | リポジトリ | 変更 |
|---|---|---|
| `scripts/lib/throughput-calibration.mjs` | taxi-ic-helper | Modify: `trackRowDeparted` を export |
| `scripts/lib/track-actuals.mjs` | taxi-ic-helper | Create: `computeTrackActuals` |
| `tests/track-actuals.test.mjs` | taxi-ic-helper | Create: テスト |
| `scripts/observe-taxi-pool.mjs` | taxi-ic-helper | Modify: `stall-actuals.json` 書き出し |
| `.github/workflows/relay-taxi-data.yml` | taxi-ic-helper | Modify: `FILES` に追加 |
| `tools/js/forecast-section.js` | 日報アプリ | Modify: `loadActuals`/`renderActualsTable`/プルダウン |
| `tools/arrivals.html` | 日報アプリ | Modify: プルダウン markup |
| `tests/forecast-section.test.js` | 日報アプリ | Modify: テスト追加 |

---

## Task 1: computeTrackActuals（taxi-ic-helper）

**作業ディレクトリ:** `乗務地図関係/`

**Files:**
- Modify: `scripts/lib/throughput-calibration.mjs`（`trackRowDeparted` を export）
- Create: `scripts/lib/track-actuals.mjs`
- Create: `tests/track-actuals.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/track-actuals.test.mjs` を新規作成:

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { computeTrackActuals } from '../scripts/lib/track-actuals.mjs';

// track 行を作る（cameras に departed を持つ v3 形）
function row(ts, departed) {
  return { schema_version: 3, ts, cameras: { real01: { departed } } };
}

test('computeTrackActuals: 直近2時間の departed を15分スロットに集計', () => {
  const now = new Date('2026-05-18T19:00:00+09:00');
  const history = [
    row('2026-05-18T18:02:00+09:00', 3), // 18:00-18:15 スロット
    row('2026-05-18T18:10:00+09:00', 2), // 同上
    row('2026-05-18T18:20:00+09:00', 5), // 18:15-18:30 スロット
    row('2026-05-18T16:30:00+09:00', 9), // 2時間より前 → 除外
  ];
  const r = computeTrackActuals(history, now);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { slotStart: '18:00', slotEnd: '18:15', total: 5 });
  assert.deepEqual(r[1], { slotStart: '18:15', slotEnd: '18:30', total: 5 });
});

test('computeTrackActuals: departed 欠損(null/cameras無し)は0扱い', () => {
  const now = new Date('2026-05-18T19:00:00+09:00');
  const history = [
    row('2026-05-18T18:05:00+09:00', null),
    { schema_version: 3, ts: '2026-05-18T18:08:00+09:00' }, // cameras 無し
    row('2026-05-18T18:12:00+09:00', 4),
  ];
  const r = computeTrackActuals(history, now);
  assert.equal(r.length, 1);
  assert.equal(r[0].total, 4);
});

test('computeTrackActuals: 空配列・未来時刻のみ → 空配列', () => {
  const now = new Date('2026-05-18T19:00:00+09:00');
  assert.deepEqual(computeTrackActuals([], now), []);
  assert.deepEqual(computeTrackActuals(undefined, now), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/track-actuals.test.mjs`
Expected: FAIL — `track-actuals.mjs` が存在せず import エラー。

- [ ] **Step 3: `trackRowDeparted` を export**

`scripts/lib/throughput-calibration.mjs` の `function trackRowDeparted(row) {` を `export function trackRowDeparted(row) {` に変更（`export` を付けるだけ。本体・他の利用箇所は不変）。

- [ ] **Step 4: `track-actuals.mjs` を実装**

`scripts/lib/track-actuals.mjs` を新規作成:

```javascript
// 車両トラッカーの実測出庫を直近 windowMinutes の15分スロットに集計する。
import { trackRowDeparted } from './throughput-calibration.mjs';

const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;

// epoch ms → JST "HH:MM"
function fmtJst(ms) {
  const jst = new Date(ms + 9 * 3600 * 1000);
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const m = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 直近 windowMinutes ぶんのトラッカー実測出庫を15分スロットで集計する。
 * @param {Array} trackHistory vehicle-track-history.jsonl の行配列
 * @param {Date} now 現在時刻
 * @param {number} [windowMinutes] 遡る分数（既定 120）
 * @returns {Array<{slotStart:string, slotEnd:string, total:number}>} 時刻昇順
 */
export function computeTrackActuals(trackHistory, now, windowMinutes = 120) {
  const endMs = now.getTime();
  const startMs = endMs - windowMinutes * 60 * 1000;
  const bins = new Map(); // binStartMs → total departed
  for (const r of trackHistory || []) {
    const tsMs = new Date(r.ts).getTime();
    if (Number.isNaN(tsMs) || tsMs < startMs || tsMs > endMs) continue;
    const binStartMs = Math.floor(tsMs / SLOT_MS) * SLOT_MS;
    bins.set(binStartMs, (bins.get(binStartMs) || 0) + trackRowDeparted(r));
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([binStartMs, total]) => ({
      slotStart: fmtJst(binStartMs),
      slotEnd: fmtJst(binStartMs + SLOT_MS),
      total,
    }));
}
```

注: 15分は UTC でも JST でも境界が一致する（JST オフセット9時間は15分の倍数）ため、`Math.floor(tsMs / SLOT_MS)` による epoch ベースの15分ビン分割で JST の15分スロットと一致する。epoch ms キーでソートするので日跨ぎも正しく並ぶ。

- [ ] **Step 5: テストを実行して成功を確認**

Run: `node --test tests/track-actuals.test.mjs`
Expected: PASS — 3件すべてパス。

- [ ] **Step 6: コミット**

```bash
cd 乗務地図関係
git add scripts/lib/throughput-calibration.mjs scripts/lib/track-actuals.mjs tests/track-actuals.test.mjs
git diff --cached --name-only
git commit -m "$(cat <<'EOF'
feat(track-actuals): トラッカー実測出庫の15分集計 computeTrackActuals を追加

vehicle-track-history の departed を直近2時間ぶん15分スロットに集計する
純関数。到着便ページの「出庫実績」表示の素データに使う。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: stall-actuals.json の書き出し＋relay配信（taxi-ic-helper）

**作業ディレクトリ:** `乗務地図関係/`

**Files:**
- Modify: `scripts/observe-taxi-pool.mjs`
- Modify: `.github/workflows/relay-taxi-data.yml`

- [ ] **Step 1: observe-taxi-pool.mjs で stall-actuals.json を書き出す**

`scripts/observe-taxi-pool.mjs` の出力パス定数群（`const ENSEMBLE_OUTPUT_PATH = './data/stall-ensemble.json';` の行付近）に追加:

```javascript
const ACTUALS_OUTPUT_PATH = './data/stall-actuals.json';
```

ファイル冒頭の import 群に追加:

```javascript
import { computeTrackActuals } from './lib/track-actuals.mjs';
```

`trackHistory` が読み込まれた後（`const calibration = computeThroughputCalibration(allHistory, trackHistory);` の行より後の、ensemble 書き出し付近）に、`stall-actuals.json` 書き出しを追加する。`jstNowIso` は同ファイル内の既存ヘルパー（JST ISO 文字列を返す）。`ENSEMBLE_OUTPUT_PATH` への `writeFileSync(...)` 行の直後に以下を追加:

```javascript
    // 出庫実績（直近2時間・15分スロット）を書き出す。到着便ページの実績表示用。
    const actualsSlots = computeTrackActuals(trackHistory, new Date());
    writeFileSync(ACTUALS_OUTPUT_PATH, JSON.stringify({
      schemaVersion: 1,
      generatedAt: jstNowIso(),
      slots: actualsSlots,
    }, null, 2) + '\n', 'utf8');
```

（`jstNowIso` の正確な名前は同ファイル内で確認すること。`THROUGHPUT_CALIBRATION_PATH` 書き出しが `generated_at: jstNowIso()` を使っている。`trackHistory` 変数も同名で存在する。）

- [ ] **Step 2: 手動実行で stall-actuals.json が生成されることを確認**

Run: `cd 乗務地図関係 && node scripts/observe-taxi-pool.mjs 2>&1 | tail -5 && ls -la data/stall-actuals.json && head -c 400 data/stall-actuals.json`
Expected: `data/stall-actuals.json` が生成され、`schemaVersion`/`generatedAt`/`slots` を持つ JSON。`slots` は `{slotStart, slotEnd, total}` の配列。エラーが出たら STOP して報告。

注: このコマンドは観測を1回実行する。生成された `data/stall-actuals.json` および更新された観測データファイルは**コミットしない**（observe-tick が回す再生成系。Step 4 で `git add` するのはコード2ファイルのみ）。

- [ ] **Step 3: relay の配信ファイルに stall-actuals.json を追加**

`.github/workflows/relay-taxi-data.yml` の `FILES` 行:

変更前:
```yaml
          FILES="arrivals.json stall-ensemble.json"
```

変更後:
```yaml
          FILES="arrivals.json stall-ensemble.json stall-actuals.json"
```

- [ ] **Step 4: 全回帰テスト**

Run: `cd 乗務地図関係 && npm test`
Expected: PASS — 全件パス（Task 1 の新規3件を含む）。失敗が出たら STOP して報告。

- [ ] **Step 5: コミットして push**

```bash
cd 乗務地図関係
git add scripts/observe-taxi-pool.mjs .github/workflows/relay-taxi-data.yml
git diff --cached --name-only   # data/ が含まれないこと
git commit -m "$(cat <<'EOF'
feat(observe): 出庫実績 stall-actuals.json を生成し relay 配信に追加

observe-tick ごとに直近2時間のトラッカー実測出庫を15分集計した
stall-actuals.json を書き出す。relay の配信ファイルにも追加し、
dev/prod の到着便ページへ届くようにする。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git pull --rebase --autostash origin main
git push origin main
```

rebase で再生成系 JSON が衝突したら `git checkout --theirs <file>` → `git add` → `git rebase --continue`。`git reset --hard` 禁止。

---

## Task 3: 日報アプリ — loadActuals / renderActualsTable（純関数）

**作業ディレクトリ:** `タクシー日報-wt-actuals/`（branch `feat/arrivals-actuals-toggle`）

**Files:**
- Modify: `tools/js/forecast-section.js`
- Test: `tests/forecast-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/forecast-section.test.js` 末尾に追加。先頭の import 行 `import { aggregateTo15min, loadEnsemble, isStale } from '../tools/js/forecast-section.js';` に `loadActuals, renderActualsTable` を追加すること。

```javascript

// --- loadActuals: stall-actuals.json の取得 ---

test('loadActuals: 成功でデータを返し error は null', async () => {
  const calls = [];
  const fetchFn = stubFetch({ 'data/stall-actuals.json': { body: { slots: [] } } }, calls);
  const r = await loadActuals(fetchFn);
  assert.deepEqual(r.data, { slots: [] });
  assert.equal(r.error, null);
  assert.ok(calls.length === 1 && calls[0].path === 'data/stall-actuals.json'
    && calls[0].options && calls[0].options.cache === 'no-store',
    'fetch には data/stall-actuals.json と cache:no-store を渡すこと');
});

test('loadActuals: 404 は error に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({ 'data/stall-actuals.json': { status: 404 } });
  const r = await loadActuals(fetchFn);
  assert.equal(r.data, null);
  assert.equal(r.error, 'HTTP 404');
});

// --- renderActualsTable: 実績スロットのテーブル描画 ---

test('renderActualsTable: スロットを時刻＋台数の表にする', () => {
  const html = renderActualsTable([
    { slotStart: '18:00', slotEnd: '18:15', total: 5 },
    { slotStart: '18:15', slotEnd: '18:30', total: 12 },
  ]);
  assert.ok(html.includes('18:00-18:15'), '時間帯ラベルを含む');
  assert.ok(html.includes('>5<'), '台数 5 を含む');
  assert.ok(html.includes('>12<'), '台数 12 を含む');
  assert.ok(html.includes('<table'), 'table 要素で描画する');
});

test('renderActualsTable: 空配列はデータなし表示', () => {
  const html = renderActualsTable([]);
  assert.ok(html.includes('実績データなし'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd タクシー日報-wt-actuals && npm test`
Expected: FAIL — `loadActuals` / `renderActualsTable` が未定義（import エラー）。

- [ ] **Step 3: `loadActuals` と `renderActualsTable` を実装**

`tools/js/forecast-section.js` に追加する。`loadActuals` は既存 `loadEnsemble`（58-67行）の直後に追加:

```javascript

// 出庫実績 JSON を取得する。失敗は例外を投げず { data, error } で返す。
export async function loadActuals(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/stall-actuals.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}
```

`renderActualsTable` は既存 `renderTable`（70-81行）の直後に追加（`renderTable` は内部関数なので export 不要だが、`renderActualsTable` はテストするため export する）:

```javascript

// 出庫実績スロット配列を HTML テーブルに描画する。
// 実績はトラッカー合算値のため乗り場別内訳は持たず、スロット合計のみ。
export function renderActualsTable(slots) {
  if (!slots || slots.length === 0) return '<p class="fc-empty">実績データなし</p>';
  const rows = slots.map(s => `<tr>
      <td class="fc-time">${s.slotStart}-${s.slotEnd}</td>
      <td class="fc-total">${s.total}</td>
    </tr>`).join('');
  return `<table class="fc-table">
    <thead><tr><th>時間帯</th><th>出庫台数</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd タクシー日報-wt-actuals && npm test`
Expected: PASS — 新規4件を含め全件パス。

- [ ] **Step 5: コミット**

```bash
cd タクシー日報-wt-actuals
git add tools/js/forecast-section.js tests/forecast-section.test.js
git diff --cached --name-only
git commit -m "$(cat <<'EOF'
feat(forecast-section): 出庫実績の取得・描画関数を追加

loadActuals (stall-actuals.json 取得) と renderActualsTable
(15分スロットの実出庫台数テーブル描画) を追加。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 日報アプリ — プルダウン切替の配線＋dev反映

**作業ディレクトリ:** `タクシー日報-wt-actuals/`（branch `feat/arrivals-actuals-toggle`）

**Files:**
- Modify: `tools/arrivals.html`
- Modify: `tools/js/forecast-section.js`（`initForecastSection`）

- [ ] **Step 1: arrivals.html にプルダウンを追加**

`tools/arrivals.html` の `#forecast-section`。変更前:

```html
  <section id="forecast-section">
```

の中の `<div id="forecast-meta" class="fc-meta">読み込み中...</div>` の**直前**に `<select>` を追加する。現状:
```html
    <div id="forecast-meta" class="fc-meta">読み込み中...</div>
```
を以下に置き換え:
```html
    <select id="forecast-mode" class="fc-mode">
      <option value="actuals">実績（直近2時間）</option>
      <option value="forecast">予測（今後2時間）</option>
    </select>
    <div id="forecast-meta" class="fc-meta">読み込み中...</div>
```

CSS は `#forecast-section h2 { ... }` の行の直後に追加:
```css
    #forecast-section .fc-mode { margin: 4px 0 8px; padding: 4px 8px; background: #16161c; color: var(--fg); border: 1px solid #333; border-radius: 6px; font-size: 13px; }
```

- [ ] **Step 2: `initForecastSection` をプルダウン対応に書き換える**

`tools/js/forecast-section.js` の `initForecastSection`（84-108行）を全置換する。

変更前: （84-108行の関数全体）

変更後:
```javascript
// 予測モードの localStorage キー。
const MODE_STORAGE_KEY = 'arrivalsForecastMode';

// 実績モードを描画する。
async function renderActualsMode(metaEl, tableEl) {
  const { data, error } = await loadActuals();
  if (error) {
    metaEl.textContent = `実績データを取得できていません（${error}）`;
    tableEl.innerHTML = '';
    return;
  }
  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  if (isStale(data.generatedAt, new Date(), STALE_MINUTES)) {
    metaEl.textContent = ts
      ? `実績データを取得できていません（最終 ${ts}）`
      : '実績データを取得できていません';
    tableEl.innerHTML = '';
    return;
  }
  metaEl.textContent = ts ? `実績 ${ts} 時点まで` : '';
  tableEl.innerHTML = renderActualsTable(data.slots);
}

// 予測モードを描画する。
async function renderForecastMode(metaEl, tableEl) {
  const { data, error } = await loadEnsemble();
  if (error) {
    metaEl.textContent = `予測データを取得できていません（${error}）`;
    tableEl.innerHTML = '';
    return;
  }
  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  if (isStale(data.generatedAt, new Date(), STALE_MINUTES)) {
    metaEl.textContent = ts
      ? `予測データを取得できていません（最終 ${ts}）`
      : '予測データを取得できていません';
    tableEl.innerHTML = '';
    return;
  }
  metaEl.textContent = ts ? `予測時刻 ${ts} 時点` : '';
  tableEl.innerHTML = renderTable(aggregateTo15min(data.slots));
}

// 到着便ページの予測セクションを初期化・描画する。
// プルダウンで実績（既定）／予測を切り替える。選択は localStorage に保存。
export async function initForecastSection() {
  const metaEl = document.getElementById('forecast-meta');
  const tableEl = document.getElementById('forecast-table-wrap');
  const modeEl = document.getElementById('forecast-mode');
  if (!metaEl || !tableEl || !modeEl) return;

  let saved = null;
  try { saved = localStorage.getItem(MODE_STORAGE_KEY); } catch { /* ignore */ }
  modeEl.value = (saved === 'forecast') ? 'forecast' : 'actuals';

  async function render() {
    metaEl.textContent = '読み込み中...';
    tableEl.innerHTML = '';
    if (modeEl.value === 'forecast') {
      await renderForecastMode(metaEl, tableEl);
    } else {
      await renderActualsMode(metaEl, tableEl);
    }
  }

  modeEl.addEventListener('change', () => {
    try { localStorage.setItem(MODE_STORAGE_KEY, modeEl.value); } catch { /* ignore */ }
    render();
  });

  await render();
}
```

- [ ] **Step 3: 全テストを実行**

Run: `cd タクシー日報-wt-actuals && npm test`
Expected: PASS — 全件パス（既存＋Task 3 の4件）。`initForecastSection` は DOM 依存のため直接のユニットテストは無いが、`loadActuals`/`renderActualsTable`/`loadEnsemble`/`aggregateTo15min`/`isStale` のテストでパーツは担保される。失敗が出たら STOP して報告。

- [ ] **Step 4: sw.js のキャッシュ版数を上げる**

`tools/arrivals.html` を変更したため、`sw.js` のキャッシュ版数を1つ上げる。`sw.js` 冒頭の `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` の数値を現状＋1にする（例 v146 なら v147）。現状値は `grep CACHE_NAME sw.js` で確認すること。

- [ ] **Step 5: コミットして dev へ push**

```bash
cd タクシー日報-wt-actuals
git add tools/arrivals.html tools/js/forecast-section.js sw.js
git diff --cached --name-only
git commit -m "$(cat <<'EOF'
feat(arrivals): 予測セクションに実績/予測プルダウンを追加

到着便ページの予測セクションを、既定=出庫実績（直近2時間）、
プルダウン切替=予測（今後2時間）にする。選択は localStorage 保存。
sw.js キャッシュ版数を更新。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git pull --rebase --autostash dev main
git push dev feat/arrivals-actuals-toggle:main
```

- [ ] **Step 6: 完了報告**

dev 反映後の状態をユーザーに報告する（本番反映はユーザーが dev で確認・承認した後。この計画には含めない）。報告に含める: dev/main の commit SHA、`stall-actuals.json` が relay 経由で届くまで observe-tick 1サイクル要すること。

---

## 完了条件

- taxi-ic-helper が `stall-actuals.json` を生成し relay が配信する（Task 1-2）。
- 日報アプリの到着便ページに実績/予測プルダウンがあり、既定で直近2時間の出庫実績、切替で予測を表示（Task 3-4）。
- 両リポジトリの `npm test` 全件パス。
- 日報アプリ側は dev 反映まで。本番反映はユーザー確認後。

## Self-Review

- **Spec coverage:** 設計パート1（`stall-actuals.json` 生成）→ Task 1-2。パート2（relay）→ Task 2 Step 3。パート3（プルダウン UI）→ Task 3-4。テスト方針 → 各 Task の TDD。デプロイ（taxi-ic-helper main直 / 日報 dev）→ Task 2 Step 5・Task 4 Step 5。
- **Placeholder scan:** TBD/TODO なし。各ステップに実コード・実コマンド。`jstNowIso` の正確名のみ実装時にファイル内確認を指示（同ファイルに既存・確実に存在）。
- **Type consistency:** `computeTrackActuals` は `{slotStart, slotEnd, total}` 配列を返し、`renderActualsTable` が同じ形を受ける。`stall-actuals.json` は `{schemaVersion, generatedAt, slots}`、`loadActuals` がそれを `data` で返し、`renderActualsMode` が `data.slots`/`data.generatedAt` を読む — 一致。`loadActuals` のfetchパス `data/stall-actuals.json` は relay の配信先 `tools/data/stall-actuals.json` とアプリの相対参照で一致（既存 `loadEnsemble` と同じ `data/` 相対）。

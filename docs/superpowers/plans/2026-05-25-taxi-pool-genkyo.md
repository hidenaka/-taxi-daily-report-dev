# タクシープール現況（混み具合・今日の流れ）+ 出庫 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 到着便ページの「タクシー出庫」を、現況（カメラ実写2枚＋混み具合＋今日の流れ）主役に拡張し、出庫実績は維持・予測は「目安」併記にする。

**Architecture:** taxi-ic-helper が現況バンドル（縮小サムネ2枚＋`pool-status.json`）を生成し、既存 `relay-taxi-data.yml` で日報リポ `tools/data/` へ配信。日報アプリ `tools/arrivals.html` が現況ブロックを描画する。占有は fill（slot-occupancy）由来で正確。

**Tech Stack:** Node ESM（純関数＋`node --test`）, Jimp（画像縮小）, GitHub Actions（relay）, バニラ JS（PWA, Service Worker）。

**2リポ・2フェーズ:**
- Phase A = `~/repos/taxi-ic-helper`（origin=本番 main。Mac mini が5分pullで稼働）。ブランチ `feat/pool-status`。
- Phase B = `~/work/taxi-dev-wt-pool-status`（日報 dev clone の worktree。ブランチ `feat/pool-status`。`dpush.sh`→tag）。

**スキーマ契約（両フェーズ共通の真実）— `pool-status.json`:**
```json
{
  "generatedAt": "2026-05-25T10:30:00+09:00",
  "cameras": {
    "real01": { "occ": 42, "fullRef": 50, "level": "crowded" },
    "real02": { "occ": 8,  "fullRef": 12, "level": "normal" }
  },
  "total": { "occ": 50, "level": "crowded" },
  "activity": { "recent1hDepartures": 38, "typical1h": 28, "ratio": 1.36, "level": "active", "arrow": "up" }
}
```
- level ∈ `"empty"|"normal"|"crowded"|"full"`、activity.level ∈ `"low"|"normal"|"active"`、arrow ∈ `"up"|"flat"|"down"`。

---

## Phase A — taxi-ic-helper（現況バンドル生成・配信）

作業ディレクトリ: `~/repos/taxi-ic-helper`

```bash
cd ~/repos/taxi-ic-helper && git fetch -q origin && git checkout -b feat/pool-status origin/main
```

### Task A1: occ→レベル / 活発さ 純関数

**Files:**
- Create: `scripts/lib/pool-status.mjs`
- Test: `tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く** — `tests/pool-status.test.mjs`

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { occLevel, activityLevel } from '../scripts/lib/pool-status.mjs';

test('occLevel: occ/fullRef を 4 段階に写像', () => {
  assert.equal(occLevel(0, 50), 'empty');     // 0%
  assert.equal(occLevel(10, 50), 'empty');    // 20% <30
  assert.equal(occLevel(20, 50), 'normal');   // 40%
  assert.equal(occLevel(35, 50), 'crowded');  // 70%
  assert.equal(occLevel(46, 50), 'full');     // 92% >=90
  assert.equal(occLevel(5, 0), 'empty');      // fullRef 0 ガード
});

test('activityLevel: 比で active/normal/low + arrow', () => {
  assert.deepEqual(activityLevel(38, 28), { ratio: 1.36, level: 'active', arrow: 'up' });
  assert.deepEqual(activityLevel(28, 28), { ratio: 1, level: 'normal', arrow: 'flat' });
  assert.deepEqual(activityLevel(10, 28), { ratio: 0.36, level: 'low', arrow: 'down' });
  assert.deepEqual(activityLevel(5, 0), { ratio: 0, level: 'normal', arrow: 'flat' }); // typical0 ガード
});
```

- [ ] **Step 2: 失敗確認** — Run: `node --test tests/pool-status.test.mjs` / Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装** — `scripts/lib/pool-status.mjs`

```javascript
// タクシープール現況 (混み具合・今日の流れ) の純関数群。
// occ/fullRef の混み具合レベルと、出庫レートの活発さを算出する。

/** occ/fullRef を 空き/普通/混雑/満車 に写像。fullRef<=0 は empty。 */
export function occLevel(occ, fullRef) {
  if (!(fullRef > 0)) return 'empty';
  const r = occ / fullRef;
  if (r < 0.30) return 'empty';
  if (r < 0.65) return 'normal';
  if (r < 0.90) return 'crowded';
  return 'full';
}

/** 直近1h出庫 recent と平常 typical の比から活発さを判定。 */
export function activityLevel(recent, typical) {
  if (!(typical > 0)) return { ratio: 0, level: 'normal', arrow: 'flat' };
  const ratio = Math.round((recent / typical) * 100) / 100;
  if (ratio >= 1.25) return { ratio, level: 'active', arrow: 'up' };
  if (ratio < 0.75) return { ratio, level: 'low', arrow: 'down' };
  return { ratio, level: 'normal', arrow: 'flat' };
}
```

- [ ] **Step 4: パス確認** — Run: `node --test tests/pool-status.test.mjs` / Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): occ→レベル/活発さ 純関数"
```

### Task A2: 現況集計（現在occ・満車基準・直近/平常出庫・status組立）

**Files:**
- Modify: `scripts/lib/pool-status.mjs`
- Test: `tests/pool-status.test.mjs`

集計に使う既存資産: `computeSlotActuals(occHistory, now, windowMinutes)`（`scripts/lib/slot-actuals.mjs`、15分スロット出庫 total を返す）。在台は slot-occupancy の occ（real01=stall1+2+3+4、real02=stall4_back）。

- [ ] **Step 1: 失敗するテストを追記** — `tests/pool-status.test.mjs`

```javascript
import { currentOccupancy, fullRefFor, buildPoolStatus } from '../scripts/lib/pool-status.mjs';

function occRow(ts, s1, s2, s3, s4, back) {
  return { ts, mode: 'day', stalls: {
    stall1: { occ: s1 }, stall2: { occ: s2 }, stall3: { occ: s3 },
    stall4: { occ: s4 }, stall4_back: { occ: back } } };
}

test('currentOccupancy: 直近 N tick の中央値を group 別に', () => {
  const base = Date.parse('2026-05-25T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 10, 8, 12, 4, 8));
  const cur = currentOccupancy(rows, new Date(base + 5 * 30000), 5);
  assert.equal(cur.real01, 34); // 10+8+12+4
  assert.equal(cur.real02, 8);
});

test('fullRefFor: group occ の92%ile・下限クランプ', () => {
  const base = Date.parse('2026-05-25T08:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push(occRow(new Date(base + i * 60000).toISOString(), i % 16, 0, 0, 0, 0));
  // real01 occ = 0..15 巡回 → 92%ile ≒ 14-15
  const fr = fullRefFor(rows, 'real01', { days: 7, pct: 0.92, min: 20, now: new Date(base + 50 * 60000) });
  assert.equal(fr, 20); // 92%ile(~15) < min(20) → クランプ
});

test('buildPoolStatus: スキーマ通りに組み立つ', () => {
  const base = Date.parse('2026-05-25T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 12, 10, 14, 4, 8));
  const st = buildPoolStatus(rows, new Date(base + 20 * 30000));
  assert.ok(['empty', 'normal', 'crowded', 'full'].includes(st.cameras.real01.level));
  assert.equal(st.cameras.real02.occ, 8);
  assert.ok(typeof st.total.occ === 'number');
  assert.ok(['low', 'normal', 'active'].includes(st.activity.level));
  assert.ok(st.generatedAt);
});
```

- [ ] **Step 2: 失敗確認** — Run: `node --test tests/pool-status.test.mjs` / Expected: FAIL（未エクスポート）

- [ ] **Step 3: 実装を追記** — `scripts/lib/pool-status.mjs`

```javascript
import { computeSlotActuals } from './slot-actuals.mjs';

const GROUPS = {
  real01: ['stall1', 'stall2', 'stall3', 'stall4'],
  real02: ['stall4_back'],
};
const FULLREF_MIN = { real01: 20, real02: 4 };

function median(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function groupOcc(row, group) {
  return GROUPS[group].reduce((s, k) => s + (typeof row.stalls?.[k]?.occ === 'number' ? row.stalls[k].occ : 0), 0);
}
function sorted(rows) {
  return (rows || []).map(r => ({ ...r, tsMs: new Date(r.ts).getTime() }))
    .filter(r => !Number.isNaN(r.tsMs)).sort((a, b) => a.tsMs - b.tsMs);
}

/** 直近 windowTicks 件の group occ 中央値（現在の在台数）。 */
export function currentOccupancy(rows, now, windowTicks = 5) {
  const rs = sorted(rows).filter(r => r.tsMs <= now.getTime());
  const tail = rs.slice(-windowTicks);
  const out = {};
  for (const g of Object.keys(GROUPS)) out[g] = Math.round(median(tail.map(r => groupOcc(r, g))));
  return out;
}

/** group occ の直近 days 日 pct パーセンタイル（満車基準）。min でクランプ。 */
export function fullRefFor(rows, group, { days = 7, pct = 0.92, min = 0, now = new Date() } = {}) {
  const cutoff = now.getTime() - days * 86400000;
  const vals = sorted(rows).filter(r => r.tsMs >= cutoff && r.tsMs <= now.getTime()).map(r => groupOcc(r, group));
  if (!vals.length) return min;
  vals.sort((a, b) => a - b);
  const idx = Math.min(vals.length - 1, Math.max(0, Math.round(pct * (vals.length - 1))));
  return Math.max(min, vals[idx]);
}

/** 直近1h出庫合計（computeSlotActuals total の合算）。 */
function recent1hDepartures(rows, now) {
  return computeSlotActuals(rows, now, 60).reduce((s, b) => s + b.total, 0);
}
/** 直近 days 日の「同じ1時間枠」出庫合計の中央値（平常）。 */
function typical1hDepartures(rows, now, days = 7) {
  const sums = [];
  for (let d = 1; d <= days; d++) {
    const past = new Date(now.getTime() - d * 86400000);
    sums.push(computeSlotActuals(rows, past, 60).reduce((s, b) => s + b.total, 0));
  }
  return Math.round(median(sums));
}

/** pool-status.json オブジェクトを組み立てる。 */
export function buildPoolStatus(rows, now = new Date()) {
  const cur = currentOccupancy(rows, now, 5);
  const cameras = {};
  for (const g of Object.keys(GROUPS)) {
    const fullRef = fullRefFor(rows, g, { min: FULLREF_MIN[g], now });
    cameras[g] = { occ: cur[g], fullRef, level: occLevel(cur[g], fullRef) };
  }
  const totalOcc = cur.real01 + cur.real02;
  const totalRef = cameras.real01.fullRef + cameras.real02.fullRef;
  const recent = recent1hDepartures(rows, now);
  const typical = typical1hDepartures(rows, now, 7);
  const act = activityLevel(recent, typical);
  return {
    generatedAt: now.toISOString(),
    cameras,
    total: { occ: totalOcc, level: occLevel(totalOcc, totalRef) },
    activity: { recent1hDepartures: recent, typical1h: typical, ratio: act.ratio, level: act.level, arrow: act.arrow },
  };
}
```

- [ ] **Step 4: パス確認** — Run: `node --test tests/pool-status.test.mjs` / Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 現在occ/満車基準/直近・平常出庫/status組立"
```

### Task A3: 配信スクリプト（pool-status.json + 縮小サムネ2枚）

**Files:**
- Create: `scripts/publish-pool-status.mjs`

画像は Jimp（既存 `slot-occupancy-tick.mjs` で使用）。最新アーカイブフレーム
`~/taxi-image-archive/<cam>/YYYY-MM-DD/HHMMSS.jpg` の末尾を縮小して書き出す。

- [ ] **Step 1: 実装** — `scripts/publish-pool-status.mjs`

```javascript
#!/usr/bin/env node
// 現況バンドルを data/ に書き出す: pool-status.json + pool-cam-real01/02.jpg。
// observe-tick-local.sh から5分毎に呼ぶ。fail-safe（失敗してもexit 0）。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Jimp } from 'jimp';
import { buildPoolStatus } from './lib/pool-status.mjs';

const OCC_PATH = './data/slot-occupancy-history.jsonl';
const ARCHIVE = process.env.TAXI_IMAGE_ARCHIVE_DIR || path.join(os.homedir(), 'taxi-image-archive');
const THUMB_W = 480;

function latestArchiveFrame(cam) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const day = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
  const dir = path.join(ARCHIVE, cam, day);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function writeThumb(cam, outName) {
  const src = latestArchiveFrame(cam);
  if (!src) { console.error(`[pool-status] no frame ${cam}`); return; }
  const img = await Jimp.read(src);
  img.resize({ w: THUMB_W });
  await img.write(`./data/${outName}`);
}

async function main() {
  try {
    if (existsSync(OCC_PATH)) {
      const rows = readFileSync(OCC_PATH, 'utf8').trim().split('\n')
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const status = buildPoolStatus(rows, new Date());
      writeFileSync('./data/pool-status.json', JSON.stringify(status, null, 2) + '\n', 'utf8');
      console.log(`[pool-status] ok total.occ=${status.total.occ} level=${status.total.level} activity=${status.activity.level}`);
    }
    await writeThumb('real01_line', 'pool-cam-real01.jpg');
    await writeThumb('real02', 'pool-cam-real02.jpg');
  } catch (e) {
    console.error(`[pool-status] failed: ${e.message}`);
  }
}
main();
```

- [ ] **Step 2: 手動実行で生成確認** — Run（Mac mini 上、アーカイブがある環境で）:

```bash
node scripts/publish-pool-status.mjs
ls -la data/pool-status.json data/pool-cam-real01.jpg data/pool-cam-real02.jpg
node -e "console.log(require('./data/pool-status.json'))"
```
Expected: 3ファイル生成、JSON がスキーマ通り、サムネ各 ~30-60KB。
（ローカル Mac で実行する場合はアーカイブが無いので JSON のみ生成・サムネは skip ログ。）

- [ ] **Step 3: コミット**

```bash
git add scripts/publish-pool-status.mjs
git commit -m "feat(pool-status): 現況バンドル配信スクリプト(json+サムネ)"
```

### Task A4: observe-tick と relay に組み込み

**Files:**
- Modify: `scripts/observe-tick-local.sh`（detect_vehicles 停止行の付近、commit 前）
- Modify: `.github/workflows/relay-taxi-data.yml`

- [ ] **Step 1: observe-tick に publish 呼び出しを追加** — `scripts/observe-tick-local.sh` の `node scripts/observe-taxi-pool.mjs` 成功後・git add の前に追記:

```bash
# 現況バンドル (pool-status.json + サムネ) を生成 (fail-safe)
node scripts/publish-pool-status.mjs || true
```

- [ ] **Step 2: git add 対象に3ファイルを追加** — `observe-tick-local.sh` の `git add data/...` 行に追記:

```
data/pool-status.json data/pool-cam-real01.jpg data/pool-cam-real02.jpg
```
（既存の長い `git add data/taxi-pool-history.jsonl ... data/slot-occupancy-history.jsonl ...` 行の末尾に空白区切りで足す。コミット判定 `git status --porcelain data/taxi-pool-history.jsonl` はそのままで可＝tick毎にjsonlは必ず変わるため同梱コミットされる。）

- [ ] **Step 3: relay の配信ファイルに追加** — `.github/workflows/relay-taxi-data.yml` の `FILES="arrivals.json stall-ensemble.json stall-actuals.json t3-pool-fill.json"` を:

```
FILES="arrivals.json stall-ensemble.json stall-actuals.json t3-pool-fill.json pool-status.json pool-cam-real01.jpg pool-cam-real02.jpg"
```
（cp ループ `cp "$SRC/$f" "tools/data/$f"` はそのままで画像も対象になる。`git status --porcelain tools/data` 判定もそのままで可。）

- [ ] **Step 4: 構文チェック**

Run: `bash -n scripts/observe-tick-local.sh && echo OK`
Expected: OK

- [ ] **Step 5: コミット**

```bash
git add scripts/observe-tick-local.sh .github/workflows/relay-taxi-data.yml
git commit -m "feat(pool-status): observe-tickで生成・relayで日報へ配信"
```

- [ ] **Step 6: Phase A デプロイ（ユーザー承認の上）**

```bash
git fetch -q origin && git rebase -q origin/main && git push origin feat/pool-status:main
```
Mac mini が5分pullで `publish-pool-status.mjs` を実行開始 → relay が日報リポ `tools/data/` へ配信。
確認: 数分後 `https://github.com/hidenaka/-taxi-daily-report-dev` の `tools/data/pool-status.json` 更新を確認。

---

## Phase B — 日報アプリ（現況UI）

作業ディレクトリ: `~/work/taxi-dev-wt-pool-status`（ブランチ `feat/pool-status`、dev clone worktree）

### Task B1: pool-status-section.js（取得＋描画ヘルパ）

**Files:**
- Create: `tools/js/pool-status-section.js`
- Test: `tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/pool-status-section.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
// ESM を動的 import（このリポの他テストの慣習に合わせる場合は適宜調整）
test('levelText/activityText/isStale', async () => {
  const m = await import('../tools/js/pool-status-section.js');
  assert.equal(m.levelText('empty'), '空き');
  assert.equal(m.levelText('full'), '満車');
  assert.equal(m.levelDots('crowded'), '●●●○');
  assert.equal(m.activityText({ level: 'active', arrow: 'up' }), '活発↑');
  assert.equal(m.activityText({ level: 'low', arrow: 'down' }), '少なめ↓');
  const now = Date.parse('2026-05-25T12:00:00+09:00');
  assert.equal(m.isStale('2026-05-25T11:00:00+09:00', now, 30), true);  // 60分前>30
  assert.equal(m.isStale('2026-05-25T11:50:00+09:00', now, 30), false); // 10分前
});
```

- [ ] **Step 2: 失敗確認** — Run: `node --test tests/pool-status-section.test.js` / Expected: FAIL

- [ ] **Step 3: 実装** — `tools/js/pool-status-section.js`

```javascript
// タクシープール現況セクション。pool-status.json と カメラサムネを描画する。
// taxi-ic-helper → relay → tools/data/ に配信されたデータを読む。
const LEVEL_JA = { empty: '空き', normal: '普通', crowded: '混雑', full: '満車' };
const LEVEL_DOTS = { empty: '●○○○', normal: '●●○○', crowded: '●●●○', full: '●●●●' };
const STALE_MINUTES = 30;

export function levelText(level) { return LEVEL_JA[level] || '—'; }
export function levelDots(level) { return LEVEL_DOTS[level] || '○○○○'; }
export function activityText(act) {
  if (!act) return '—';
  const label = { active: '活発', normal: '平常', low: '少なめ' }[act.level] || '—';
  const arrow = { up: '↑', flat: '→', down: '↓' }[act.arrow] || '';
  return `${label}${arrow}`;
}
export function isStale(generatedAt, nowMs, maxMinutes = STALE_MINUTES) {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return (nowMs - t) > maxMinutes * 60 * 1000;
}

export async function loadPoolStatus(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/pool-status.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

export async function initPoolStatusSection() {
  const metaEl = document.getElementById('pool-status-meta');
  const occEl = document.getElementById('pool-status-occ');
  const actEl = document.getElementById('pool-status-activity');
  const img1 = document.getElementById('pool-cam-real01');
  const img2 = document.getElementById('pool-cam-real02');
  if (!metaEl || !occEl) return;

  async function render() {
    const cb = Date.now();
    if (img1) img1.src = `data/pool-cam-real01.jpg?t=${cb}`;
    if (img2) img2.src = `data/pool-cam-real02.jpg?t=${cb}`;
    const { data, error } = await loadPoolStatus();
    if (error || !data) { metaEl.textContent = '現況データを取得できていません'; return; }
    if (isStale(data.generatedAt, Date.now())) {
      metaEl.textContent = '現況データが配信停止中の可能性があります';
    } else {
      const ts = String(data.generatedAt).slice(11, 16);
      metaEl.textContent = `直近 ${ts} 時点`;
    }
    const t = data.total || {};
    occEl.innerHTML = `混み具合: <span class="ps-dots">${levelDots(t.level)}</span> ${levelText(t.level)}（在台 約${t.occ ?? '—'}台）`;
    if (actEl) {
      const a = data.activity || {};
      actEl.innerHTML = `今日の流れ: <strong>${activityText(a)}</strong>（直近1h 出庫${a.recent1hDepartures ?? '—'}台 / 平常${a.typical1h ?? '—'}台）`;
    }
  }
  await render();
  return render;
}
```

- [ ] **Step 4: パス確認** — Run: `node --test tests/pool-status-section.test.js` / Expected: PASS
  （注: このリポのテストが ESM import を扱えない場合は、`levelText` 等を別の小さな
  `.mjs` か CommonJS helper に切り出すか、他テストの import 方式に合わせる。）

- [ ] **Step 5: コミット**

```bash
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(arrivals): 現況セクションのローダ・描画ヘルパ"
```

### Task B2: arrivals.html に現況ブロック＋予測ラベル変更

**Files:**
- Modify: `tools/arrivals.html`

- [ ] **Step 1: 見出しと現況ブロックを追加** — `<section id="forecast-section">` 直下の `<h2>🚕 タクシー出庫...` を次に置換し、その直後（`<div class="help-video" ...>` の後）に現況ブロックを挿入:

見出し置換:
```html
    <h2>🚕 タクシープール現況・出庫<button class="help-video-btn" data-help-video="arrivals" type="button">▶ 使い方（15秒）</button></h2>
```
現況ブロック挿入（`<p class="fc-scope">※台数は…</p>` の前）:
```html
    <div id="pool-status-block" style="margin:8px 0 12px;">
      <div class="ps-cams" style="display:flex; gap:6px;">
        <img id="pool-cam-real01" alt="プール(第1〜4)" style="width:50%; border-radius:6px; background:#111;" />
        <img id="pool-cam-real02" alt="プール(第4待機)" style="width:50%; border-radius:6px; background:#111;" />
      </div>
      <div id="pool-status-meta" style="color:var(--sub); font-size:11px; margin-top:4px;">読み込み中...</div>
      <div id="pool-status-occ" style="margin-top:4px;">混み具合: —</div>
      <div id="pool-status-activity" style="margin-top:2px;">今日の流れ: —</div>
    </div>
```

- [ ] **Step 2: 予測 option のラベル変更** — `<option value="forecast">予測</option>` を:

```html
        <option value="forecast">予測（目安・学習中）</option>
```

- [ ] **Step 3: 現況スタイルの最小追加** — `<style>` 内に:

```css
    #pool-status-block .ps-dots { letter-spacing:1px; }
    #pool-status-occ, #pool-status-activity { font-size:13px; }
```

- [ ] **Step 4: 目視確認（構文）** — Run: `grep -n "pool-status-block\|現況・出庫\|目安・学習中" tools/arrivals.html`
  Expected: 3箇所ヒット

- [ ] **Step 5: コミット**

```bash
git add tools/arrivals.html
git commit -m "feat(arrivals): 現況ブロック(写真2+混み具合+流れ)追加・予測ラベル変更"
```

### Task B3: arrivals-app.js 初期化 + sw.js bump

**Files:**
- Modify: `tools/js/arrivals-app.js`
- Modify: `sw.js`

- [ ] **Step 1: import と初期化を追加** — `tools/js/arrivals-app.js` 冒頭の import 群に追加:

```javascript
import { initPoolStatusSection } from './pool-status-section.js';
```
末尾の `initForecastSection().then(...)` の直後に追加:
```javascript
let refreshPoolStatus = () => {};
initPoolStatusSection().then(fn => { if (fn) refreshPoolStatus = fn; });
```
既存の `setInterval(() => { refresh(); refreshForecast(); }, 60000);` を:
```javascript
setInterval(() => { refresh(); refreshForecast(); refreshPoolStatus(); }, 60000);
```

- [ ] **Step 2: sw.js の CACHE_NAME bump と precache 追加** — `sw.js`:
  - `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` を次の版数へ（現行を確認し +1。例 v215→v216。既に上がっていれば現行+1）。
  - precache 資産リスト（`./tools/js/...` が並ぶ配列）に追加:
```javascript
  './tools/js/pool-status-section.js',
```

- [ ] **Step 3: 確認** — Run:
```bash
grep -n "pool-status-section.js" tools/js/arrivals-app.js sw.js
grep -n "CACHE_PREFIX + 'v" sw.js
```
Expected: arrivals-app.js と sw.js 双方にヒット、CACHE_NAME が新版数。

- [ ] **Step 4: テスト一式（回帰）** — Run: `node --test tests/*.test.js 2>&1 | tail -5`
  Expected: 既存テスト全パス（新規 pool-status-section テスト含む。既存赤があれば本変更と無関係か確認）。

- [ ] **Step 5: コミット**

```bash
git add tools/js/arrivals-app.js sw.js
git commit -m "feat(arrivals): 現況セクション初期化・SWキャッシュbump"
```

### Task B4: dev デプロイ＆確認 → 本番

- [ ] **Step 1: dev 反映（ユーザーが実行）**

```
!~/work/taxi-dev/dpush.sh ~/work/taxi-dev-wt-pool-status
```

- [ ] **Step 2: dev 目視確認** — dev URL の到着便ページで:
  - カメラ2枚が表示される（Phase A 配信後）。
  - 混み具合（レベル＋在台台数）・今日の流れ（活発/平常/少なめ＋矢印）が出る。
  - 出庫実績テーブルは従来どおり。予測は「予測（目安・学習中）」。
  - データ古い時に「配信停止中」表示。

- [ ] **Step 3: 本番反映（dev OK 後・承認の上）** — `tagpush.sh` の版タグを新版へ更新して push（本番デプロイ）。リリース後 PWA 再起動（アプリを閉じて開き直し）を案内。

---

## 実装順序の注意
- **Phase A を先に**本番反映し、`tools/data/pool-status.json` が日報リポに配信されてから Phase B の dev 確認をすると写真・数値が出る（Phase B 単体でも STALE/未取得表示で壊れない）。
- taxi-ic-helper の push（A6）と 日報の tag（B4-3）は**それぞれユーザー承認**。

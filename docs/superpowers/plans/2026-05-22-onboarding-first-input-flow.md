# 初回入力導線（オンボーディング#2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規ドライバーが申込直後に迷わず最初の日報入力へ到達できるようにする。

**Architecture:** ホーム(index.html)に「日報0件の新規ユーザーにだけ出る行動カード」を追加し、データが入ると自然消滅させる。判定は純関数 `shouldShowFirstRunCard` に切り出してテスト。申込完了(subscribe-success.html)にも入力ボタンを追加。

**Tech Stack:** Vanilla JS ESM、`node --test` + `tests/run.js` ハーネス、Service Worker キャッシュ。

**作業基点:** `~/work/taxi-dev`（dev/main・branch `feat/onboarding-first-input`）。spec: `docs/superpowers/specs/2026-05-22-onboarding-first-input-flow-design.md`。

---

### Task 1: 判定純関数 `js/first-run.js`

**Files:**
- Create: `js/first-run.js`
- Test: `tests/first-run.test.js`

- [ ] **Step 1: Write the failing test**

`tests/first-run.test.js`:
```js
import { test, assert } from './run.js';
import { shouldShowFirstRunCard } from '../js/first-run.js';

test('shouldShowFirstRunCard: 日報が無ければ true', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: false }), true);
});

test('shouldShowFirstRunCard: 日報があれば false', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: true }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/first-run.test.js`
Expected: FAIL（`Cannot find module '../js/first-run.js'` 等）

- [ ] **Step 3: Write minimal implementation**

`js/first-run.js`:
```js
// 初回行動カードの表示判定。日報が1件も無い新規ユーザーにのみ true。
export function shouldShowFirstRunCard({ hasAnyDrive }) {
  return hasAnyDrive === false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/first-run.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add js/first-run.js tests/first-run.test.js
git commit -m "feat(onboarding): 初回カード判定の純関数 shouldShowFirstRunCard"
```

---

### Task 2: ホーム初回行動カード（index.html）

**Files:**
- Modify: `index.html`（import 追加・カードのマークアップ追加・表示制御関数追加・render から呼び出し）

- [ ] **Step 1: import を追加**

`index.html` の import 群末尾、`import { checkInviteAndWarn, fetchCompanyExists } from './js/invite-url.js';` の直後の行に追加:
```js
import { shouldShowFirstRunCard } from './js/first-run.js';
```

- [ ] **Step 2: カードのマークアップを追加**

`index.html` の `<section class="card" id="pwaInstallBanner" ...>...</section>`（PWAインストール促しバナー）の閉じ `</section>` 直後、`<section class="card" id="todayHintCard" ...>` の直前に追加:
```html
  <section class="card" id="firstRunCard" style="display:none;background:#fff7ed;border:1px solid #fdba74;padding:14px;">
    <div style="font-size:15px;font-weight:700;color:#9a3412;margin-bottom:6px;">最初の日報を入れてみましょう</div>
    <p style="font-size:13px;line-height:1.6;color:#7c2d12;margin:0 0 10px;">営業明細（日報）の写真があれば、ボタンから選ぶだけで自動入力できます。</p>
    <a href="input.html" style="display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">📷 明細の写真から入力</a>
    <p style="font-size:11px;line-height:1.6;color:#9a6a4a;margin:10px 0 0;">まだ写真が無い方は、次の乗務のあとに明細の写真を撮っておきましょう。</p>
  </section>
```

- [ ] **Step 3: 表示制御関数を追加**

`index.html` の `async function render() {` の定義の直前に、次の関数を追加:
```js
// 初回行動カード: 日報が1件も無い新規ユーザーにのみ表示。データが入ると消える。
async function maybeShowFirstRunCard(isCurrent, currentCount) {
  const card = document.getElementById('firstRunCard');
  if (!card) return;
  // 当期にデータあり → 既存ユーザー。marker をセットして隠す
  if (currentCount > 0) {
    try { localStorage.setItem('cabis_has_drive', '1'); } catch (e) {}
    card.style.display = 'none';
    return;
  }
  // 当期0件でも、現在月度でなければ出さない（過去/未来の閲覧時）
  if (!isCurrent) { card.style.display = 'none'; return; }
  // marker があれば既存ユーザー
  let hasAnyDrive = false;
  try { hasAnyDrive = localStorage.getItem('cabis_has_drive') === '1'; } catch (e) {}
  // marker 無ければ前期も確認（安全側: 取得失敗時は出さない）
  if (!hasAnyDrive) {
    try {
      const prev = await getDrivesForMonth(shiftBillingPeriod(viewPeriod, -1));
      if (prev && prev.length > 0) {
        hasAnyDrive = true;
        try { localStorage.setItem('cabis_has_drive', '1'); } catch (e) {}
      }
    } catch (e) { card.style.display = 'none'; return; }
  }
  card.style.display = shouldShowFirstRunCard({ hasAnyDrive }) ? 'block' : 'none';
}
```

- [ ] **Step 4: render() から呼び出す**

`index.html` の `render()` 内、`const isCurrent = !isPast && !isFuture;` の行の直後に追加:
```js
  await maybeShowFirstRunCard(isCurrent, rawDrives.length);
```

- [ ] **Step 5: 全テスト通過を確認（既存を壊していない）**

Run: `cd ~/work/taxi-dev && npm test`
Expected: PASS（既存全件 + first-run 2件）。FAIL なら直す。

- [ ] **Step 6: Commit**

```bash
cd ~/work/taxi-dev
git add index.html
git commit -m "feat(onboarding): ホームに初回入力カードを追加（日報0件時のみ表示）"
```

---

### Task 3: 申込完了に入力ボタン（subscribe-success.html）

**Files:**
- Modify: `subscribe-success.html`（ボタン部の差し替え）

- [ ] **Step 1: ボタンを差し替え**

`subscribe-success.html` の次の1行:
```html
  <a href="index.html" class="btn" style="display:block;text-align:center;text-decoration:none;background:var(--primary);color:#fff;">ホームへ進む</a>
```
を、次に置き換え:
```html
  <a href="input.html" class="btn" style="display:block;text-align:center;text-decoration:none;background:var(--primary);color:#fff;margin-bottom:10px;">📷 さっそく最初の日報を入れる</a>
  <a href="index.html" style="display:block;text-align:center;text-decoration:none;color:var(--primary);font-size:13px;">あとで（ホームへ進む）</a>
```

- [ ] **Step 2: 構文確認（HTMLが壊れていない）**

Run: `cd ~/work/taxi-dev && node -e "const s=require('fs').readFileSync('subscribe-success.html','utf8'); if(!s.includes('input.html')||!s.includes('あとで（ホームへ進む）')) throw new Error('置換失敗'); console.log('ok');"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd ~/work/taxi-dev
git add subscribe-success.html
git commit -m "feat(onboarding): 申込完了画面に最初の日報入力ボタンを追加"
```

---

### Task 4: Service Worker（キャッシュ登録＋バージョン bump）

**Files:**
- Modify: `sw.js`（STATIC_FILES に first-run.js 追加・CACHE_NAME bump）

- [ ] **Step 1: STATIC_FILES に追加**

`sw.js` の STATIC_FILES 内、`'./js/app.js',` の直後の行に追加:
```js
  './js/first-run.js',
```

- [ ] **Step 2: CACHE_NAME を bump**

`sw.js` の `const CACHE_NAME = CACHE_PREFIX + 'v198';` を次に変更:
```js
const CACHE_NAME = CACHE_PREFIX + 'v199';
```
（注: dev/main 最新が v198 でない場合は「最新+1」にすること。push 直前に再確認）

- [ ] **Step 3: 構文確認**

Run: `cd ~/work/taxi-dev && node -e "require('fs').readFileSync('sw.js','utf8').includes(\"./js/first-run.js\")||(()=>{throw new Error('missing')})(); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-dev
git add sw.js
git commit -m "chore(sw): first-run.js をキャッシュ登録・CACHE_NAME bump"
```

---

### Task 5: 通し検証（ヘッドレス・スモーク）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト**

Run: `cd ~/work/taxi-dev && npm test`
Expected: 全 PASS。

- [ ] **Step 2: index.html を静的に検証（カード要素と表示制御が存在）**

Run:
```bash
cd ~/work/taxi-dev && node -e "
const s=require('fs').readFileSync('index.html','utf8');
['id=\"firstRunCard\"','maybeShowFirstRunCard','shouldShowFirstRunCard','📷 明細の写真から入力'].forEach(k=>{ if(!s.includes(k)) throw new Error('missing: '+k); });
console.log('index ok');
"
```
Expected: `index ok`

- [ ] **Step 3: （任意）実機相当の確認は本人 dev で**

dev 反映後、本人が dev 実機で「新規アカウントのホームに初回カードが出る／日報を1件入れると消える」を確認。
（自動操作は Turnstile/Stripe のため不可。AIはカード描画ロジックの静的検証まで）

- [ ] **Step 4: dev 反映（本人合図後）**

```bash
cd ~/work/taxi-dev
git push dev feat/onboarding-first-input:main
```
→ GitHub Actions / Pages で dev に反映。本人が dev 実機確認 → OK なら本番（`v*` タグ運用、本セッションの別ステップで実施）。

---

## Self-Review

- **Spec coverage:** firstRunCard（Task2）/ subscribe-success ボタン（Task3）/ 純関数（Task1）/ sw 登録（Task4）/ テスト（Task1,5）/ デプロイ手順（Task5）= spec 全項目に対応。
- **Placeholder scan:** TODO/TBD なし。全コード実体記載。
- **Type consistency:** `shouldShowFirstRunCard({ hasAnyDrive })` の引数キー `hasAnyDrive` を Task1(定義)・Task2(呼出)・テストで一致。marker キー `cabis_has_drive` を Task2 内で一貫使用。
- **Out of scope 厳守:** 動画・IC/需要予測・会社設定値には触れない。

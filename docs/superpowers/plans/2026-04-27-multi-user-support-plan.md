# マルチユーザーサポート 実装計画

> **✅ 完了 (2026-05-14 時点)**: Task 1-13 は全て実装済み。Task 14 (統合動作確認) も実運用で知人1人を登録済み。
> Plan上のチェックボックスは履歴として `- [ ]` のまま残しているが、コードベースに反映済み (`js/userid.js`, `js/storage.js`, `js/parser.js`, `input.html`, `support.html`, `sw.js` v93, ドキュメント類)。
> Plan以上の進化: Firebase Firestore 移行 / 認証強化 / キャッシュ層 / 車種フィルタリング。
> 詳細管理: `.company/pm/projects/taxi-daily-report-active-plans.md`

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 信頼できる知り合い2-5人とGitHub Private Repoで日報データを共有し、営業サポートの集計精度を高める(個人パフォーマンスは独立、需要パターンは統合)

**Architecture:** 既存 `data/drives/YYYY-MM-DD.json` を `data/drives/{userId}/YYYY-MM-DD.json` に変更。`localStorage` に自分の `userId` を保持。`storage.js` は書き込み系を必ず自分のフォルダに固定し、新規 `getAllUsersDrivesForMonth` で全ユーザー集計のみ可能にする。AI(Gemini/Claude)が日報写真を指定フォーマットのテキストに変換 → 入力画面でペースト → 既存パーサ拡張版で取込。

**Tech Stack:** Vanilla JS ES modules / GitHub REST API / localStorage / node:test (パーサのみ) / Service Worker (キャッシュバスト)

**仕様参照:** `docs/superpowers/specs/2026-04-27-multi-user-support-design.md`

---

## File Structure

### 新規作成
- `js/userid.js` — userId 検証ロジック(node test 可能な純関数だけここに分離)
- `tests/userid.test.js` — userId 検証のユニットテスト
- `tests/parsefmt.test.js` — `parseFormattedReport` のユニットテスト
- `tests/fixtures/sample-formatted.txt` — フォーマット済みテキストのテスト入力
- `docs/ai-prompt-template.md` — 知り合い向け AI 変換プロンプトテンプレ
- `docs/setup-for-collaborator.md` — 知り合い向けセットアップ手順書

### 修正
- `js/storage.js` — パス変更 + 新規 4 関数追加
- `js/parser.js` — `parseFormattedReport` 追加(既存 `parseReport` は変更しない)
- `settings.html` — userId / displayName 入力欄追加
- `input.html` — 「テキストペースト」モード追加
- `support.html` — 自分のみ vs 全員統合のデータ分離
- `sw.js` — STATIC_FILES に `userid.js` 追加 + キャッシュバージョン bump
- `README.md` — マルチユーザー対応の説明追記

### 一回限りのスクリプト(コミットしない)
- 既存 `data/drives/*.json` → `data/drives/user_self/*.json` 移動
- 既存 `data/config.json` → `data/config/user_self.json` コピー
- `data/users.json` 新規作成

### 各ファイルの責務
- `js/userid.js`: userId 文字列のバリデーションとサニタイズ。fetch などのI/Oは持たない(=node test 可能)
- `js/storage.js`: GitHub REST API 呼び出し + パス組み立て。書き込み系は内部で `getMyUserId()` を呼ぶことで他人フォルダへの書き込みを物理的に不可能にする
- `js/parser.js`: 既存 `parseReport` (タブ/CSV単純表)、新規 `parseFormattedReport` (4行ヘッダー + 区切り表)。両者を分離して既存テストを壊さない
- `support.html`: `myDrives` (自分の集計) と `allDrives` (全員統合) を別変数で持ち、機能ごとに使い分け

---

## 実装方針メモ

- 既存 `parseReport` は壊さない。`parseFormattedReport` は別関数として追加し、内部で既存 `parseReport` を再利用する
- `storage.js` のテストは node では困難(fetch 依存)。パス生成のような純粋ロジックは `userid.js` に分離して node でテストする
- UI 変更(settings/input/support) はブラウザ手動テストで検証
- マイグレーションは git で追跡可能なので、誤動作してもロールバック容易
- 1 タスクごとにコミット。コミットメッセージは「feat:/refactor:/test:/docs:」プレフィックス + 簡潔な本文

---

## Task 1: userId 検証ロジック (純関数のみ)

**Files:**
- Create: `js/userid.js`
- Create: `tests/userid.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/userid.test.js`:
```js
import { test, assert } from './run.js';
import { isValidUserId, normalizeUserId, DEFAULT_USER_ID } from '../js/userid.js';

test('isValidUserId: 英小文字+数字+_ で先頭が英字 → true', () => {
  assert.equal(isValidUserId('user_self'), true);
  assert.equal(isValidUserId('user_a'), true);
  assert.equal(isValidUserId('a1'), true);
});

test('isValidUserId: 大文字・記号・空文字 → false', () => {
  assert.equal(isValidUserId('User_A'), false);
  assert.equal(isValidUserId('user-a'), false);
  assert.equal(isValidUserId(''), false);
  assert.equal(isValidUserId('1user'), false);
  assert.equal(isValidUserId('user.a'), false);
  assert.equal(isValidUserId(null), false);
  assert.equal(isValidUserId(undefined), false);
});

test('normalizeUserId: 前後空白除去 + 小文字化', () => {
  assert.equal(normalizeUserId('  user_A  '), 'user_a');
  assert.equal(normalizeUserId('USER_SELF'), 'user_self');
});

test('DEFAULT_USER_ID は user_self', () => {
  assert.equal(DEFAULT_USER_ID, 'user_self');
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm test`
Expected: `tests/userid.test.js` の全テストが「Cannot find module '../js/userid.js'」で失敗

- [ ] **Step 3: 最小実装**

`js/userid.js`:
```js
export const DEFAULT_USER_ID = 'user_self';

export function isValidUserId(id) {
  if (typeof id !== 'string') return false;
  return /^[a-z][a-z0-9_]*$/.test(id);
}

export function normalizeUserId(id) {
  if (typeof id !== 'string') return '';
  return id.trim().toLowerCase();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: userid.test.js の全テストが PASS。既存テスト(parser/payroll/sanity)も引き続き PASS

- [ ] **Step 5: コミット**

```bash
git add js/userid.js tests/userid.test.js
git commit -m "feat: add userId validation helpers"
```

---

## Task 2: storage.js に userId 取得・保存関数を追加

**Files:**
- Modify: `js/storage.js`

`getMyUserId` / `setMyUserId` を追加。localStorage キー `taxi_user_id`。未設定なら `DEFAULT_USER_ID` を返す。

- [ ] **Step 1: storage.js の先頭(import 直後)に DEFAULT_USER_ID をインポート**

`js/storage.js` の先頭(`const API_BASE = ...` の下)に追加:
```js
import { DEFAULT_USER_ID, isValidUserId, normalizeUserId } from './userid.js';

const USER_ID_KEY = 'taxi_user_id';

export function getMyUserId() {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (!raw) return DEFAULT_USER_ID;
  const norm = normalizeUserId(raw);
  return isValidUserId(norm) ? norm : DEFAULT_USER_ID;
}

export function setMyUserId(id) {
  const norm = normalizeUserId(id);
  if (!isValidUserId(norm)) {
    throw new Error('userId は英小文字始まりで英小文字・数字・アンダースコアのみ使用可');
  }
  localStorage.setItem(USER_ID_KEY, norm);
  return norm;
}
```

- [ ] **Step 2: 既存テストが落ちないことを確認**

Run: `npm test`
Expected: 既存テスト(parser/payroll/sanity/userid)が全て PASS。storage.js は import 元が node に存在しないので直接テストはしない(ブラウザで動作確認)

- [ ] **Step 3: コミット**

```bash
git add js/storage.js
git commit -m "feat: add getMyUserId/setMyUserId to storage"
```

---

## Task 3: storage.js のパスを userId 別に変更

**Files:**
- Modify: `js/storage.js`

既存関数のパス組み立てを `getMyUserId()` 経由に変更。書き込み系は引数で別 userId を受け取らない(=自分以外への書き込み不可をコードで保証)。

- [ ] **Step 1: getDrive のパスを変更**

`js/storage.js` の `getDrive` を修正:
```js
export async function getDrive(date) {
  const userId = getMyUserId();
  const result = await getFile(`data/drives/${userId}/${date}.json`);
  return result?.content || null;
}
```

- [ ] **Step 2: getDrivesForMonth のパスを変更**

`js/storage.js` の `getDrivesForMonth` を修正:
```js
export async function getDrivesForMonth(yearMonth) {
  const userId = getMyUserId();
  const { start, end } = getBillingPeriodRange(yearMonth);
  const files = await listFiles(`data/drives/${userId}`);
  const periodFiles = files.filter(f => {
    if (!f.name.endsWith('.json')) return false;
    const date = f.name.replace('.json', '');
    return date >= start && date <= end;
  });
  const drives = await Promise.all(
    periodFiles.map(f => getFile(f.path).then(r => r?.content))
  );
  return drives.filter(d => d !== null);
}
```

- [ ] **Step 3: saveDrive のパスを変更**

`js/storage.js` の `saveDrive` を修正:
```js
export async function saveDrive(drive) {
  const userId = getMyUserId();
  const path = `data/drives/${userId}/${drive.date}.json`;
  const existing = await getFile(path);
  const sha = existing?.sha || null;
  const message = sha
    ? `update drive ${userId}/${drive.date}`
    : `add drive ${userId}/${drive.date}`;
  return putFile(path, drive, message, sha);
}
```

- [ ] **Step 4: getConfig / saveConfig のパスを変更**

```js
export async function getConfig() {
  const userId = getMyUserId();
  const result = await getFile(`data/config/${userId}.json`);
  return result?.content || null;
}

export async function saveConfig(config) {
  const userId = getMyUserId();
  const path = `data/config/${userId}.json`;
  const existing = await getFile(path);
  const sha = existing?.sha || null;
  return putFile(path, config, `update config ${userId}`, sha);
}
```

- [ ] **Step 5: 既存テストが落ちないことを確認**

Run: `npm test`
Expected: 全テスト PASS (storage は node テストなしなので実害なし)

- [ ] **Step 6: コミット**

```bash
git add js/storage.js
git commit -m "refactor: scope storage paths to {userId} folder"
```

---

## Task 4: 既存データを user_self/ にマイグレーション

**Files:**
- Move: `data/drives/*.json` → `data/drives/user_self/*.json`
- Copy: `data/config.json` → `data/config/user_self.json` (旧ファイルは残す、後で削除)
- Create: `data/users.json`

注意: `git mv` が使えない場合はファイル移動 + git add で OK。

- [ ] **Step 1: マイグレーション前のファイル数を記録**

```bash
ls data/drives/*.json 2>/dev/null | wc -l
ls data/config.json 2>/dev/null
```

Expected: 数百ファイルが drives 直下に存在することを確認

- [ ] **Step 2: drives ファイルを user_self/ に移動**

```bash
mkdir -p data/drives/user_self
git mv data/drives/*.json data/drives/user_self/ 2>/dev/null || \
  (for f in data/drives/*.json; do mv "$f" data/drives/user_self/; done)
```

Expected: `data/drives/user_self/YYYY-MM-DD.json` が大量に存在し、`data/drives/` 直下には `.json` が無くなる

- [ ] **Step 3: config を user_self にコピー(旧ファイルは残す)**

```bash
mkdir -p data/config
cp data/config.json data/config/user_self.json
```

Expected: `data/config/user_self.json` が新規作成。`data/config.json` も残っている(ロールバック保険)

- [ ] **Step 4: data/users.json を作成**

`data/users.json`:
```json
{
  "users": [
    { "userId": "user_self", "displayName": "自分", "active": true }
  ]
}
```

- [ ] **Step 5: マイグレーション後の状態を確認**

```bash
ls data/drives/user_self/ | head -3
ls data/config/
cat data/users.json
```

Expected:
- `data/drives/user_self/` に過去乗務 .json が並んでいる
- `data/config/user_self.json` と旧 `data/config.json` が両方存在
- `data/users.json` が表示される

- [ ] **Step 6: コミット**

```bash
git add data/
git commit -m "chore: migrate existing data to user_self folder"
```

---

## Task 5: storage.js に listActiveUserIds と getAllUsersDrivesForMonth を追加

**Files:**
- Modify: `js/storage.js`

- [ ] **Step 1: listActiveUserIds を追加**

`js/storage.js` の最後(`flushPendingQueue` の後)に追加:
```js
// data/users.json から active: true の userId 配列を取得
export async function listActiveUserIds() {
  const result = await getFile('data/users.json');
  if (!result?.content?.users) {
    // フォールバック: users.json が無い場合は自分のみ
    return [getMyUserId()];
  }
  return result.content.users
    .filter(u => u.active === true)
    .map(u => u.userId);
}
```

- [ ] **Step 2: getAllUsersDrivesForMonth を追加**

`js/storage.js` の listActiveUserIds の下に追加:
```js
// 全 active userId の月度データを並列取得して flatten
export async function getAllUsersDrivesForMonth(yearMonth) {
  const { start, end } = getBillingPeriodRange(yearMonth);
  const userIds = await listActiveUserIds();
  const perUser = await Promise.all(userIds.map(async userId => {
    let files;
    try {
      files = await listFiles(`data/drives/${userId}`);
    } catch (e) {
      // フォルダ未作成のユーザーはスキップ
      return [];
    }
    const periodFiles = files.filter(f => {
      if (!f.name.endsWith('.json')) return false;
      const date = f.name.replace('.json', '');
      return date >= start && date <= end;
    });
    const drives = await Promise.all(
      periodFiles.map(f => getFile(f.path).then(r => r?.content))
    );
    // 集計時にユーザー識別できるよう、_userId を非破壊的に付与
    return drives.filter(d => d !== null).map(d => ({ ...d, _userId: userId }));
  }));
  return perUser.flat();
}
```

- [ ] **Step 3: テストが落ちないことを確認**

Run: `npm test`
Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add js/storage.js
git commit -m "feat: add listActiveUserIds and getAllUsersDrivesForMonth"
```

---

## Task 6: settings.html に userId / displayName 入力欄を追加

**Files:**
- Modify: `settings.html`

仕様: 共有PAT入力欄の隣に userId と displayName を追加。
- userId: 英小文字始まり、英数字+_ のみ。デフォルト `user_self`。保存時に `setMyUserId()` を呼ぶ
- displayName: 任意。`config` の一部として `saveConfig` で保存

- [ ] **Step 1: 現状の settings.html の入力欄構造を確認**

```bash
grep -n 'github_token\|github_data_repo\|takeHomeTarget\|<form\|<input' settings.html | head -40
```

Expected: GitHub設定セクション(token, repo)と config 編集セクションの構造が分かる

- [ ] **Step 2: ユーザーID入力欄のHTMLを追加**

`settings.html` の GitHub設定セクション(共有PAT入力欄の直後)に挿入:
```html
<div class="setting-row">
  <label for="userId">あなたのユーザーID(共有用)</label>
  <input type="text" id="userId" placeholder="user_self" pattern="^[a-z][a-z0-9_]*$" />
  <p class="hint">英小文字始まり・英数字とアンダースコアのみ。あなた以外は user_a / user_b など。</p>
</div>
<div class="setting-row">
  <label for="displayName">表示名(任意)</label>
  <input type="text" id="displayName" placeholder="自分" />
  <p class="hint">集計画面の表示用。本名は推奨しない。</p>
</div>
```
(class 名は既存スタイルに合わせて調整)

- [ ] **Step 3: JS で読み書きを実装**

`settings.html` の script ブロックに以下を追加:
```js
import { getMyUserId, setMyUserId, getConfig, saveConfig } from './js/storage.js';

async function loadUserSettings() {
  document.getElementById('userId').value = getMyUserId();
  const cfg = await getConfig();
  if (cfg?.displayName) document.getElementById('displayName').value = cfg.displayName;
}

async function saveUserSettings() {
  const userIdInput = document.getElementById('userId').value;
  try {
    setMyUserId(userIdInput);  // 検証込み
  } catch (e) {
    alert(e.message);
    return;
  }
  // displayName は config に追加
  const cfg = (await getConfig()) || {};
  cfg.userId = getMyUserId();
  cfg.displayName = document.getElementById('displayName').value;
  await saveConfig(cfg);
  alert('保存しました');
}

document.getElementById('saveUserSettingsBtn').addEventListener('click', saveUserSettings);
loadUserSettings();
```
(既存の保存ボタンと統合する場合はそちらに組み込む)

- [ ] **Step 4: ブラウザで動作確認(手動)**

確認項目:
- userId に `user_a` を入力して保存 → 再読込で `user_a` が表示される
- userId に `User-A` を入力して保存 → 検証エラーが alert で表示される
- displayName を保存 → GitHub の `data/config/user_a.json` に書き込まれる
- userId を `user_self` に戻す

- [ ] **Step 5: コミット**

```bash
git add settings.html
git commit -m "feat: add userId/displayName fields to settings"
```

---

## Task 7: parser.js に parseFormattedReport を追加

**Files:**
- Modify: `js/parser.js`
- Create: `tests/fixtures/sample-formatted.txt`
- Create: `tests/parsefmt.test.js`

仕様: 4 行ヘッダー(`日付:` / `車種:` / `出庫:` / `帰庫:`) + `---` 区切り + 既存 CSV/タブ表 をパースして `{ date, vehicleType, departureTime, returnTime, trips, rests }` を返す。

- [ ] **Step 1: フィクスチャを作成**

`tests/fixtures/sample-formatted.txt`:
```
日付: 2026-04-26
車種: premium
出庫: 07:00
帰庫: 01:16
---
No,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計
1,07:17,07:38,0:21,迎,大田区上池台4,港区港南2,6.7,1,,"3,600"
休,10:47,11:36,0:49,,江東区青海2,,,,,
2,11:40,11:55,0:15,迎,江東区青海2,中央区銀座8,4.2,2,1,"2,100"
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/parsefmt.test.js`:
```js
import { test, assert } from './run.js';
import { parseFormattedReport } from '../js/parser.js';
import { readFileSync } from 'node:fs';

test('parseFormattedReport: ヘッダー4項目を抽出', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-04-26');
  assert.equal(r.vehicleType, 'premium');
  assert.equal(r.departureTime, '07:00');
  assert.equal(r.returnTime, '01:16');
});

test('parseFormattedReport: trips 2件・rests 1件を抽出', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips.length, 2);
  assert.equal(r.rests.length, 1);
});

test('parseFormattedReport: 引用符付き金額をパース', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips[0].amount, 3600);
  assert.equal(r.trips[1].amount, 2100);
});

test('parseFormattedReport: 男女列を無視して正しく合計列を取る', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips[0].boardPlace, '大田区上池台4');
  assert.equal(r.trips[0].alightPlace, '港区港南2');
  assert.equal(r.trips[0].km, 6.7);
});

test('parseFormattedReport: 不完全ヘッダーでも data 部分は処理', () => {
  const text = '日付: 2026-04-26\n---\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n1,07:00,07:10,0:10,,A,B,1.0,,,"500"';
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-04-26');
  assert.equal(r.vehicleType, '');
  assert.equal(r.trips.length, 1);
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npm test`
Expected: parsefmt.test.js が「parseFormattedReport is not exported」で失敗

- [ ] **Step 4: parseFormattedReport を実装**

`js/parser.js` の最後に追加:
```js
// 4行ヘッダー + --- + CSV/タブ表 のフォーマットをパース
export function parseFormattedReport(text) {
  const lines = text.split('\n');
  const header = { 日付: '', 車種: '', 出庫: '', 帰庫: '' };
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') { dataStart = i + 1; break; }
    const m = line.match(/^(日付|車種|出庫|帰庫):\s*(.*)$/);
    if (m) header[m[1]] = m[2].trim();
  }
  const dataText = lines.slice(dataStart).join('\n');
  const inner = parseReport(dataText);
  return {
    date: header.日付,
    vehicleType: header.車種,
    departureTime: header.出庫,
    returnTime: header.帰庫 || inner.returnTime,
    trips: inner.trips,
    rests: inner.rests,
    format: inner.format
  };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: parsefmt.test.js + 既存 parser.test.js が全て PASS

- [ ] **Step 6: コミット**

```bash
git add js/parser.js tests/parsefmt.test.js tests/fixtures/sample-formatted.txt
git commit -m "feat: add parseFormattedReport for header+CSV format"
```

---

## Task 8: input.html に「テキストペースト」モードを追加

**Files:**
- Modify: `input.html`

仕様: 既存の入力モード(おそらく日報写真OCR or 直接入力)に「テキストペースト」モードを追加。textarea + 「解析プレビュー」ボタン + 「保存」ボタン。

- [ ] **Step 1: 現状の input.html の入力UIを確認**

```bash
grep -n '<form\|<textarea\|<button\|saveDrive\|parseReport' input.html | head -40
```

Expected: 既存の入力モードがどう実装されているか把握

- [ ] **Step 2: モード切替トグルとペースト UI を追加**

`input.html` の入力フォーム冒頭に挿入:
```html
<div class="mode-switcher">
  <button type="button" id="modeNormal" class="active">通常入力</button>
  <button type="button" id="modePaste">テキストペースト</button>
</div>

<section id="pasteSection" hidden>
  <p class="hint">AI(Gemini/Claude)で日報を変換したテキストを貼り付けてください。フォーマット: 4行ヘッダー(日付/車種/出庫/帰庫) + --- + CSV表</p>
  <textarea id="pasteText" rows="12" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
  <div>
    <button type="button" id="parsePreviewBtn">解析プレビュー</button>
    <button type="button" id="pasteSaveBtn" disabled>保存</button>
  </div>
  <div id="pastePreview" style="margin-top:1em;"></div>
</section>
```

- [ ] **Step 3: モード切替のJSを追加**

`input.html` の script ブロックに追加:
```js
import { parseFormattedReport } from './js/parser.js';
import { saveDriveSafe } from './js/storage.js';

const modeNormal = document.getElementById('modeNormal');
const modePaste = document.getElementById('modePaste');
const normalSection = document.querySelector('form'); // 既存フォーム要素
const pasteSection = document.getElementById('pasteSection');

modeNormal.addEventListener('click', () => {
  modeNormal.classList.add('active');
  modePaste.classList.remove('active');
  normalSection.hidden = false;
  pasteSection.hidden = true;
});
modePaste.addEventListener('click', () => {
  modePaste.classList.add('active');
  modeNormal.classList.remove('active');
  normalSection.hidden = true;
  pasteSection.hidden = false;
});
```

- [ ] **Step 4: 解析プレビューと保存のJSを追加**

```js
let parsedDrive = null;

document.getElementById('parsePreviewBtn').addEventListener('click', () => {
  const text = document.getElementById('pasteText').value;
  let r;
  try {
    r = parseFormattedReport(text);
  } catch (e) {
    document.getElementById('pastePreview').innerHTML = `<p style="color:red">解析失敗: ${e.message}</p>`;
    return;
  }
  if (!r.date) {
    document.getElementById('pastePreview').innerHTML = `<p style="color:red">日付ヘッダーが取得できません</p>`;
    return;
  }
  parsedDrive = {
    date: r.date,
    vehicleType: r.vehicleType,
    departureTime: r.departureTime,
    returnTime: r.returnTime,
    trips: r.trips,
    rests: r.rests
  };
  document.getElementById('pastePreview').innerHTML = `
    <p>日付: ${r.date} / 車種: ${r.vehicleType} / 出庫: ${r.departureTime} / 帰庫: ${r.returnTime}</p>
    <p>乗務件数: ${r.trips.length}件 / 休憩: ${r.rests.length}回</p>
    <p>合計売上: ¥${r.trips.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString()}</p>
  `;
  document.getElementById('pasteSaveBtn').disabled = false;
});

document.getElementById('pasteSaveBtn').addEventListener('click', async () => {
  if (!parsedDrive) return;
  try {
    await saveDriveSafe(parsedDrive);
    alert(`保存しました: ${parsedDrive.date}`);
    document.getElementById('pasteText').value = '';
    document.getElementById('pastePreview').innerHTML = '';
    document.getElementById('pasteSaveBtn').disabled = true;
    parsedDrive = null;
  } catch (e) {
    alert(`保存失敗: ${e.message}`);
  }
});
```

- [ ] **Step 5: ブラウザで動作確認(手動)**

確認項目:
- 「テキストペースト」ボタンを押す → ペースト UI が表示される
- `tests/fixtures/sample-formatted.txt` の中身を貼り付け → 「解析プレビュー」で件数・合計が表示される
- 「保存」ボタンで GitHub の `data/drives/user_self/2026-04-26.json` に書き込まれる(または既存と被ったら上書き)
- ホーム画面で当日が表示される

- [ ] **Step 6: コミット**

```bash
git add input.html
git commit -m "feat: add text-paste input mode to input page"
```

---

## Task 9: support.html を「自分のみ」と「全員統合」に分離

**Files:**
- Modify: `support.html`

仕様:
- ペース参考カード + 曜日×時間ヒートマップ → 自分のみ(`getDrivesForMonth`)
- 推奨検索 / 高期待値エリア / 降車エリア別 / 過去履歴 / 近隣マップ → 全員統合(`getAllUsersDrivesForMonth`)
- 集計対象数を画面上部に表示(例: `全員モード: 3ユーザー / 合計540乗務`)

- [ ] **Step 1: 現状の support.html のデータ取得箇所を確認**

```bash
grep -n 'getDrivesForMonth\|drives\.' support.html | head -30
```

Expected: 単一の `drives` 変数で全機能が動いている状態

- [ ] **Step 2: import を更新**

`support.html` の import 文を:
```js
import { getDrivesForMonth, getAllUsersDrivesForMonth, listActiveUserIds } from './js/storage.js';
```
に変更(既存の `getDrivesForMonth` import に `getAllUsersDrivesForMonth, listActiveUserIds` を追加)

- [ ] **Step 3: データロード関数を 2 系統に分離**

既存の `loadDrives()` 相当を以下のように書き換え:
```js
let myDrives = [];
let allDrives = [];

async function loadAllData(yearMonths) {
  // 6か月分など、複数月の場合は配列で渡す
  const myParts = await Promise.all(yearMonths.map(ym => getDrivesForMonth(ym)));
  myDrives = myParts.flat();
  const allParts = await Promise.all(yearMonths.map(ym => getAllUsersDrivesForMonth(ym)));
  allDrives = allParts.flat();
}
```

- [ ] **Step 4: 各機能のデータソースを切替**

ペース参考カードとヒートマップの呼び出しを `myDrives` に固定:
```js
renderPaceCard(myDrives);
renderHourlyDowHeatmap(myDrives);
```

推奨検索・履歴・エリア分析の呼び出しを `allDrives` に切替:
```js
renderRecommend(allDrives, neighbors);
renderHighValueAreas(allDrives);
renderDropoffAnalysis(allDrives);
const neighbors = buildNeighborMap(allDrives);
```

- [ ] **Step 5: 集計対象数表示を追加**

`support.html` の上部に状態表示エリアを追加:
```html
<div id="dataSourceInfo" style="font-size:12px;color:#666;margin-bottom:1em;"></div>
```

JS で更新:
```js
async function updateDataSourceInfo() {
  const userIds = await listActiveUserIds();
  document.getElementById('dataSourceInfo').textContent =
    `全員モード: ${userIds.length}ユーザー / 合計${allDrives.length}乗務(自分: ${myDrives.length}乗務)`;
}
```

各セクションの説明文に「自分のみ」「全員統合」を追記:
- ペース参考: 「(自分のデータのみ)」
- ヒートマップ: 「(自分のデータのみ)」
- 推奨検索 / 高期待値 / 降車エリア別: 「(全員データ統合)」

- [ ] **Step 6: ブラウザで動作確認(手動)**

確認項目:
- 「全員モード: 1ユーザー / 合計N乗務」が表示される(初期は自分のみ)
- ペース参考とヒートマップが既存通りに動く
- 推奨検索・高期待値・降車エリア別が既存通りに動く(まだ自分以外のデータが無いので件数は同じ)
- エラーが出ない

- [ ] **Step 7: コミット**

```bash
git add support.html
git commit -m "feat: split support.html into self-only and all-users data sources"
```

---

## Task 10: sw.js のキャッシュバージョンを bump + userid.js を追加

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: STATIC_FILES に userid.js を追加 + バージョン bump**

`sw.js` の `STATIC_FILES` 配列の `'./js/storage.js',` の上(または js セクション内)に追加:
```js
  './js/userid.js',
```

そして `CACHE_NAME` を bump:
```js
const CACHE_NAME = 'taxi-daily-v66';
```

- [ ] **Step 2: ブラウザで動作確認(手動)**

確認項目:
- ページリロード → DevTools の Application タブで新キャッシュ `taxi-daily-v66` が生成される
- 古いキャッシュが削除される
- userid.js が cache に含まれる

- [ ] **Step 3: コミット**

```bash
git add sw.js
git commit -m "chore: cache v66 + register userid.js"
```

---

## Task 11: AI 変換プロンプトテンプレを作成

**Files:**
- Create: `docs/ai-prompt-template.md`

仕様: 知り合いがコピーしてGemini/Claude に投げる用のプロンプト。日報写真からアプリ取込フォーマットを生成させる。

- [ ] **Step 1: ドキュメントを作成**

`docs/ai-prompt-template.md`:
```markdown
# AI日報変換プロンプト(知り合い向け)

## 使い方

1. Gemini または Claude のチャットを開く
2. このページの「プロンプト本文」をコピー
3. 日報の写真をアップロード + プロンプト送信
4. 出力されたテキストを全選択コピー
5. タクシー日報アプリ → 入力画面 → 「テキストペースト」モード → 貼り付け → 解析プレビュー → 保存

## 推奨AI

- Gemini Free (gemini.google.com)
- Claude Free (claude.ai)
- どちらも無料枠で十分動作する

## プロンプト本文

このタクシー日報の写真を以下のテキスト形式で出力してください。コードブロックや前置きは不要、テキストのみ出力してください。

先頭に4行ヘッダー:
日付: YYYY-MM-DD
車種: premium または regular
出庫: HH:MM
帰庫: HH:MM
---

その後にCSV表(日報のフォーマットそのまま):
No,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計
1,07:17,07:38,0:21,迎,大田区上池台4,港区港南2,6.7,1,,"3,600"
休,10:47,11:36,0:49,,江東区青海2,,,,,

ルール:
- 休憩行は「No」を「休」とする(時間欄のみ埋める)
- キャンセル行は「No」を「キ」とする
- 料金はカンマ区切りでクォート("3,600"のように)
- 日付・車種が判別不能なら空欄のまま(削除しない)
- 男女列は人数。読み取れなければ空欄
- 「迎」列は迎車なら「迎」、流しは空欄
- 営Km は実車距離の小数

---

## トラブルシューティング

- **写真が読めないと言われる**: 解像度を上げて再撮影、または1枚ずつ送る
- **金額が違う**: 写真をプレビューで再確認、AIが「,」を見落としたケースが多い
- **日付が空欄**: 日付欄の写りを確認、複数日分が混ざっていないか確認
```

- [ ] **Step 2: コミット**

```bash
git add docs/ai-prompt-template.md
git commit -m "docs: add AI prompt template for collaborators"
```

---

## Task 12: 知り合い向けセットアップ手順書を作成

**Files:**
- Create: `docs/setup-for-collaborator.md`

- [ ] **Step 1: ドキュメントを作成**

`docs/setup-for-collaborator.md`:
```markdown
# セットアップ手順書(知り合い向け)

このアプリは、タクシー乗務日報を共有するためのものです。

## 必要なもの

- スマートフォン(iPhone / Android)
- Gemini か Claude の無料アカウント
- 主催者から受け取る:
  - アプリのURL
  - 共有用 GitHub PAT(個人アクセストークン)
  - あなた専用のユーザーID(例: `user_a`)

## セットアップ手順

### 1. アプリを開いてホーム画面に追加(PWAインストール)

- 主催者から受け取ったURLをスマホのブラウザで開く
- iPhone(Safari): 共有ボタン → 「ホーム画面に追加」
- Android(Chrome): メニュー → 「アプリをインストール」

### 2. 設定画面を開く

- ホーム画面に追加したアプリアイコンをタップ
- 下部メニューの「設定」を開く

### 3. 共有 PAT を入力

- 「GitHub Personal Access Token」欄に主催者から受け取ったトークンを貼り付け
- 「データリポジトリ」欄に主催者から指定されたリポジトリ名を入力(例: `主催者名/taxi-daily-report-data`)

### 4. ユーザーID と表示名を入力

- 「あなたのユーザーID」欄に主催者から指定された ID を入力(例: `user_a`)
- 「表示名」欄に好きな表示名を入力(任意)
- 「保存」ボタンをタップ

### 5. 初回テスト送信

- 当日(または直近)の日報の写真を撮る
- Gemini または Claude を開く
- `docs/ai-prompt-template.md` の「プロンプト本文」をコピー & ペースト + 写真をアップ
- 出力テキストをすべてコピー
- アプリ → 「入力」画面 → 「テキストペースト」モード
- 貼り付け → 「解析プレビュー」 → 件数と合計を確認
- 「保存」をタップ
- ホーム画面で当日の乗務が表示されることを確認

## トラブルシューティング

- **保存に失敗する**: GitHub PAT の権限を確認(repo スコープ必須)
- **データが共有されない**: ユーザーID が間違っていないか設定画面で確認
- **AI 出力フォーマットがおかしい**: `docs/ai-prompt-template.md` を再度参照、写真を撮り直す

## 注意事項

- 共有 PAT は他人に渡さないでください
- ユーザーID は本名にしないでください(例: `user_a`, `taro1`, `driver_x` のような匿名ID)
- 入力した日報データは主催者と他の参加者全員が閲覧できます(個人収入は各自にしか見えませんが、乗車地・降車地・時間・金額は共有されます)
- アプリは未完成です。バグ報告は主催者まで
```

- [ ] **Step 2: コミット**

```bash
git add docs/setup-for-collaborator.md
git commit -m "docs: add setup guide for collaborators"
```

---

## Task 13: README.md にマルチユーザー対応の説明を追記

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 現状の README を確認**

```bash
head -40 README.md
```

- [ ] **Step 2: マルチユーザーセクションを追加**

`README.md` の末尾(または「使い方」セクションの後)に追記:
```markdown
## マルチユーザー対応(2026-04-27 追加)

複数人で同じデータリポジトリを共有して、営業サポートの集計精度を高められます。

### データ構造

- `data/drives/{userId}/YYYY-MM-DD.json` — 乗務データ(ユーザーごとフォルダ分離)
- `data/config/{userId}.json` — 各ユーザーの設定
- `data/users.json` — 集計対象のアクティブユーザー一覧

### スコープ

- **個人パフォーマンス**(収入・効率・時給など): 各ユーザー独立
- **需要パターン**(降車エリア後の次乗車・推奨検索など): 全ユーザー統合

### 知り合いを追加する手順

1. `data/users.json` に新ユーザーを追記(`{ "userId": "user_X", "displayName": "...", "active": true }`)
2. 共有 PAT を発行 or 既存PATを共有
3. `docs/setup-for-collaborator.md` を渡す
4. AI プロンプトテンプレ `docs/ai-prompt-template.md` を渡す
```

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: add multi-user section to README"
```

---

## Task 14: 統合動作確認(手動)

**Files:** なし(動作確認のみ)

- [ ] **Step 1: 既存機能のリグレッションを確認**

確認項目(全画面):
- ホーム: 月度集計が正しく表示される
- カレンダー: 過去乗務が表示される
- 詳細: 過去乗務の中身が見える
- 振り返り: 6か月分の集計が出る
- 設定: GitHub PAT / userId / displayName / その他既存項目が編集できる
- 営業サポート: ペース参考・ヒートマップが自分のみ、推奨検索が「1ユーザー統合」表示

- [ ] **Step 2: マルチユーザー動作確認(2人目を仮想で追加)**

1. ローカルで `data/drives/user_test/` フォルダを作成し、test.json を 1 個だけ手動で配置
2. `data/users.json` に `{ "userId": "user_test", "displayName": "テスト", "active": true }` を追記
3. アプリを再読み込み → 営業サポート → 「全員モード: 2ユーザー」が表示されることを確認
4. 設定で userId を `user_test` に変更 → 「入力」画面で test.json の編集 or 新規保存 → `data/drives/user_test/` 配下に書き込まれることを確認
5. userId を `user_self` に戻す
6. テスト用フォルダ・users.jsonエントリを削除

- [ ] **Step 3: 旧データパスの削除(動作確認後のクリーンアップ)**

すべて動作確認できたら旧 `data/config.json` を削除:
```bash
git rm data/config.json
git commit -m "chore: remove legacy config.json (migrated to user_self)"
```

- [ ] **Step 4: 最終コミット(必要なら)**

統合動作確認で見つかった軽微な修正があればここで適用してコミット。

---

## 完了基準(MVP)

仕様書 §12 の成功基準を満たすこと:

1. **リグレッションなし**: 自分が既存通り全機能を使える
2. **新規参加成功**: 知り合い1人がセットアップ手順書通りにデータ取込できる
3. **統合精度向上**: 営業サポートで「全員データ」モードが動く

---

## Self-Review メモ

仕様(`docs/superpowers/specs/2026-04-27-multi-user-support-design.md` §11 MVP 必須9項目)とタスクの対応:

| 仕様MVP項目 | 対応タスク |
|---|---|
| ① データパス変更 | Task 3 |
| ② 既存データを user_self へ移動 | Task 4 |
| ③ storage.js 新関数 4 つ | Task 2 (getMyUserId/setMyUserId) + Task 5 (listActiveUserIds/getAllUsersDrivesForMonth) |
| ④ 設定画面 userId 入力欄 | Task 6 |
| ⑤ 営業サポート 全員データ切替 | Task 9 |
| ⑥ 入力画面テキストペーストモード | Task 8 |
| ⑦ parser.js 拡張 | Task 7 |
| ⑧ AI プロンプトテンプレ | Task 11 |
| ⑨ 知り合い向けセットアップ手順書 | Task 12 |

追加: Task 1 (userid.js 純関数), Task 10 (sw.js cache bump), Task 13 (README), Task 14 (統合動作確認) でカバー漏れなし。

# Home Public Holiday Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ホームの月度カレンダーで、明けの翌日から次の出番の前日までを公休として自動判定し、薄い赤色と「公休」ラベルで表示する。

**Architecture:** `js/planned-shifts.js` に日付配列だけを受け取る純粋関数 `isRosterDayOff` を追加する。`index.html` は営業実績日と全予定日を渡し、既存状態がないセルにだけ `roster-day-off` を付与する。保存形式とカレンダー編集操作は変更しない。

**Tech Stack:** Vanilla JavaScript ES modules、Node.js built-in test runner、HTML/CSS、GitHub Pages PWA

---

## File Map

- Modify: `js/planned-shifts.js` — ISO日付の検証と公休判定を担当する純粋関数。
- Modify: `tests/planned-shifts.test.js` — 公休定義と境界条件の単体テスト。
- Create: `tests/home-calendar-roster-day-off.test.js` — ホーム画面への接続、表示、凡例、状態優先順位の静的回帰テスト。
- Modify: `index.html` — 公休スタイル、判定呼び出し、セル表示、凡例。
- Modify: `sw.js` — PWAキャッシュバージョン更新。

### Task 1: 公休判定の純粋関数

**Files:**
- Modify: `tests/planned-shifts.test.js`
- Modify: `js/planned-shifts.js`

- [ ] **Step 1: 失敗する公休判定テストを追加する**

`tests/planned-shifts.test.js` の import に `isRosterDayOff` を追加し、末尾に次を追加する。

```js
test('isRosterDayOff: 明けを除き次の出番までを公休にする', () => {
  const actual = ['2026-07-09'];
  const planned = ['2026-07-14'];
  assert.equal(isRosterDayOff('2026-07-10', actual, planned), false);
  assert.equal(isRosterDayOff('2026-07-11', actual, planned), true);
  assert.equal(isRosterDayOff('2026-07-12', actual, planned), true);
  assert.equal(isRosterDayOff('2026-07-13', actual, planned), true);
  assert.equal(isRosterDayOff('2026-07-14', actual, planned), false);
});

test('isRosterDayOff: 前後どちらかの出番がなければ公休にしない', () => {
  assert.equal(isRosterDayOff('2026-07-08', ['2026-07-09'], []), false);
  assert.equal(isRosterDayOff('2026-07-11', ['2026-07-09'], []), false);
});

test('isRosterDayOff: 実績と予定を結合し重複を除いて判定する', () => {
  const actual = ['2026-06-30', '2026-06-30'];
  const planned = ['2026-07-04', '2026-07-04'];
  assert.equal(isRosterDayOff('2026-07-01', actual, planned), false);
  assert.equal(isRosterDayOff('2026-07-02', actual, planned), true);
  assert.equal(isRosterDayOff('2026-07-03', actual, planned), true);
});

test('isRosterDayOff: 連続出番と不正日付を安全に扱う', () => {
  assert.equal(isRosterDayOff('2026-07-10', ['2026-07-09'], ['2026-07-10']), false);
  assert.equal(isRosterDayOff('2026-02-30', ['2026-02-27'], ['2026-03-03']), false);
  assert.equal(isRosterDayOff('not-a-date', ['2026-07-09'], ['2026-07-14']), false);
});
```

- [ ] **Step 2: テストが機能未実装で失敗することを確認する**

Run:

```bash
node --test tests/planned-shifts.test.js
```

Expected: FAIL。`isRosterDayOff` が export されていないことが原因で失敗する。

- [ ] **Step 3: 最小の公休判定を実装する**

`js/planned-shifts.js` に次を追加する。

```js
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (!ISO_DATE_RE.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addIsoDays(value, days) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isRosterDayOff(date, driveDates = [], plannedDates = []) {
  if (!isValidIsoDate(date)) return false;
  const shifts = [...new Set([...(driveDates || []), ...(plannedDates || [])])]
    .filter(isValidIsoDate)
    .sort();
  if (shifts.includes(date)) return false;

  let previous = null;
  let next = null;
  for (const shift of shifts) {
    if (shift < date) previous = shift;
    if (shift > date) {
      next = shift;
      break;
    }
  }
  if (!previous || !next) return false;
  return date > addIsoDays(previous, 1) && date < next;
}
```

- [ ] **Step 4: 単体テストを通す**

Run:

```bash
node --test tests/planned-shifts.test.js
```

Expected: PASS、失敗0件。

- [ ] **Step 5: 判定ロジックをコミットする**

```bash
git add js/planned-shifts.js tests/planned-shifts.test.js
git commit -m "feat: derive roster days off from shifts"
```

### Task 2: ホームカレンダーへ公休表示を接続

**Files:**
- Create: `tests/home-calendar-roster-day-off.test.js`
- Modify: `index.html`

- [ ] **Step 1: ホーム接続の失敗テストを追加する**

`tests/home-calendar-roster-day-off.test.js` を次の内容で作成する。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('ホームカレンダーが公休判定を読み込みセルへ適用する', () => {
  assert.match(source, /import \{[^}]*isRosterDayOff[^}]*\} from '\.\/js\/planned-shifts\.js'/s);
  assert.match(source, /isRosterDayOff\(iso, driveDates, plannedSet\)/);
  assert.match(source, /cls\.push\('roster-day-off'\)/);
});

test('既存状態を優先し公休だけに公休ラベルを表示する', () => {
  assert.match(source, /const isDayOff = !drive && !isPaid && !isPlanned/);
  assert.match(source, /else if \(isDayOff\)[\s\S]*<div class="tag">公休<\/div>/);
});

test('ホームカレンダーに公休の薄赤スタイルと凡例がある', () => {
  assert.match(source, /\.cal-cell\.roster-day-off\s*\{[^}]*background:\s*#fff1f1;[^}]*border-color:\s*#e6a7a7;/s);
  assert.match(source, /公休（自動判定）/);
});
```

- [ ] **Step 2: 接続テストが失敗することを確認する**

Run:

```bash
node --test tests/home-calendar-roster-day-off.test.js
```

Expected: FAIL。import、クラス、表示、凡例がまだ存在しないため失敗する。

- [ ] **Step 3: ホームのスタイルと import を追加する**

`index.html` のホーム専用カレンダーCSSに追加する。

```css
.cal-cell.roster-day-off { background: #fff1f1; border-color: #e6a7a7; }
.cal-cell.roster-day-off .tag { color: #8f3434; }
```

`planned-shifts.js` の import を次の形に更新する。

```js
import { getPlannedVehicle, pruneOrphanVehicles, countMonthlyShifts, isRosterDayOff } from './js/planned-shifts.js';
```

- [ ] **Step 4: 描画前に公休を判定し、既存状態より後に適用する**

`renderCalendar` で実績日配列を1回だけ作る。

```js
const driveDates = drives.map(d => d.date);
```

各日付の状態取得後に次を追加する。

```js
const isDayOff = !drive && !isPaid && !isPlanned
  && isRosterDayOff(iso, driveDates, plannedSet);
```

クラス判定の既存 `else if (isPlanned && iso >= today)` の後に追加する。

```js
else if (isDayOff) {
  cls.push('roster-day-off');
}
```

表示内容の既存 `else if (isPlanned && iso >= today)` の後に追加する。

```js
else if (isDayOff) {
  inner = `<div class="day">${day}</div><div class="tag">公休</div>`;
}
```

公休はクリック可能にせず、既存 `onclick` と `cursor` の条件は変更しない。

- [ ] **Step 5: 凡例へ公休を追加する**

有給凡例の後へ次を追加する。

```html
<span><span style="display:inline-block;width:10px;height:10px;background:#fff1f1;border:1px solid #e6a7a7;border-radius:2px;vertical-align:middle;"></span> 公休（自動判定）</span>
```

- [ ] **Step 6: ホーム接続テストと単体テストを通す**

Run:

```bash
node --test tests/home-calendar-roster-day-off.test.js tests/planned-shifts.test.js
```

Expected: PASS、失敗0件。

- [ ] **Step 7: ホーム表示をコミットする**

```bash
git add index.html tests/home-calendar-roster-day-off.test.js
git commit -m "feat: show automatic roster days off on home"
```

### Task 3: PWA更新と総合検証

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: PWAキャッシュ番号を更新する**

`sw.js` の `CACHE_NAME` を現在の `v330` から `v331` に変更する。

```js
const CACHE_NAME = CACHE_PREFIX + 'v331';
```

- [ ] **Step 2: 構文と全自動テストを実行する**

Run:

```bash
node --check js/planned-shifts.js
node --check sw.js
npm test
git diff --check
```

Expected: すべて終了コード0、テスト失敗0件、空白エラーなし。

- [ ] **Step 3: モバイル幅でホームを確認する**

ローカルHTTPサーバーで `index.html` を開き、390x844相当で確認する。

確認項目:

- 薄赤の公休セルが既存の青・水色・紫と混同しない。
- `公休` がセル幅からはみ出さない。
- 今日が公休でもオレンジ枠が見える。
- 明けの日は通常背景のまま。
- 公休セルにクリックカーソルや遷移が付かない。

- [ ] **Step 4: キャッシュ更新をコミットする**

```bash
git add sw.js
git commit -m "chore: refresh PWA cache for roster days off"
```

- [ ] **Step 5: devへpushし、GitHub Pagesを確認する**

```bash
git push dev HEAD:main
```

`https://hidenaka.github.io/-taxi-daily-report-dev/` で開発環境バッジ、公休セル、凡例を確認し、GitHub Actionsが成功していることを確認する。

- [ ] **Step 6: 本番反映前にユーザー確認を取る**

dev画面の確認結果を報告し、タグ作成と本番デプロイの承認を得る。承認前に `v*` タグをpushしない。

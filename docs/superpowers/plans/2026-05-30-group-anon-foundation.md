# グループ匿名プール基盤（純ロジック）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** drive/trip を「身元なし・エリア粗化済みの個別乗車(pool item)」へ変換する純ロジックモジュール `js/group-anon.js` を TDD で作る。

**Architecture:** 副作用なしの純関数のみ。1日(drive)単位でまとめず trip 単位のバラに落とす（仕様 §4.1：1日まとめ＝個人合計の復元を防ぐ）。エリア粗化は既存 `extractArea()`（chart-helpers.js）を再利用。共有オプトアウト(`drive.shareOptOut`)とキャンセル(`trip.isCancel`)は除外。後続の Worker（プラン2）がこの関数群を使って匿名プールを構築する。

**Tech Stack:** Vanilla ESM JavaScript（ブラウザ/Node 共通）、テストは `node --test`（node:test, ESM）。作業場所は隔離worktree `~/work/taxi-group-sharing`（branch `feat/group-anon-sharing`）。

**確定済みの事実（コード確認済み）:**
- trip キー: `boardTime` / `alightTime` / `boardPlace` / `alightPlace` / `km` / `amount` / `isPickup`(迎車true/false) / `isCharter` / `isCancel` / `no` / `pickupKind` / `type:'trip'`。**人数(男女)は trip に保存されていない**ので pool に含めない。
- `extractArea(place)`（js/chart-helpers.js:658）= `place.replace(/\d+$/,'').trim()`。例「大田区上池台4」→「大田区上池台」、「新宿区霞ヶ丘町」→そのまま。
- drive キー: `date` / `departureTime` / `returnTime` / `trips[]` / `rests[]` / `totalKm` / `companyId` / `updatedAt`。本機能で `shareOptOut:boolean`(任意) を追加利用。
- pool item に入れる項目: `boardTime` / `pickupArea` / `dropoffArea` / `km` / `amount` / `isPickup`。**userId・メモ・生の boardPlace(丁目)・pickupKind・no は入れない**。

---

### Task 1: tripToPoolItem — 1 trip を匿名 pool item に変換

**Files:**
- Create: `js/group-anon.js`
- Test: `tests/group-anon.test.js`

- [ ] **Step 1: Write the failing test**

`tests/group-anon.test.js` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { tripToPoolItem } from '../js/group-anon.js';

test('tripToPoolItem: 通常乗車を匿名itemに変換しエリアを粗化する', () => {
  const item = tripToPoolItem({
    type: 'trip', no: 1, pickupKind: '迎',
    boardTime: '07:17', alightTime: '07:38',
    boardPlace: '大田区上池台4', alightPlace: '港区港南2',
    km: 6.7, amount: 3600, isPickup: true, isCharter: false, isCancel: false,
  });
  assert.deepEqual(item, {
    boardTime: '07:17',
    pickupArea: '大田区上池台',
    dropoffArea: '港区港南',
    km: 6.7,
    amount: 3600,
    isPickup: true,
  });
});

test('tripToPoolItem: 身元/生地名/メモ系のキーは含めない', () => {
  const item = tripToPoolItem({
    type: 'trip', no: 3, pickupKind: '迎', boardPlace: '中央区銀座8',
    alightPlace: '江東区青海2', boardTime: '11:40', amount: 2100, km: 4.2,
    isPickup: true, isCancel: false, _userId: 'taro', memo: '常連さん',
  });
  assert.deepEqual(Object.keys(item).sort(),
    ['amount', 'boardTime', 'dropoffArea', 'isPickup', 'km', 'pickupArea']);
  assert.ok(!('boardPlace' in item) && !('no' in item) && !('_userId' in item) && !('memo' in item));
});

test('tripToPoolItem: キャンセルは null', () => {
  assert.equal(tripToPoolItem({ type: 'trip', isCancel: true, amount: 0 }), null);
});

test('tripToPoolItem: 乗車以外(休憩 type!==trip)は null', () => {
  assert.equal(tripToPoolItem({ type: 'rest', startTime: '10:47', endTime: '11:36' }), null);
});

test('tripToPoolItem: 欠損値は null/空に正規化', () => {
  const item = tripToPoolItem({ type: 'trip', isCancel: false });
  assert.equal(item.boardTime, null);
  assert.equal(item.pickupArea, null);
  assert.equal(item.dropoffArea, null);
  assert.equal(item.km, null);
  assert.equal(item.amount, null);
  assert.equal(item.isPickup, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: FAIL（`Cannot find module '../js/group-anon.js'` または `tripToPoolItem is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-anon.js` を新規作成:

```js
// グループ匿名プール用の純ロジック。
// drive/trip を「身元なし・エリア粗化済みの個別乗車(pool item)」へ変換する。
// 1日(drive)単位でまとめず trip 単位のバラに落とす（仕様 §4.1：1日まとめ＝個人合計の復元を防ぐ）。
// 副作用なし・I/Oなし。後続の Worker がこの関数群でプールを構築する。
import { extractArea } from './chart-helpers.js';

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 1 trip → 匿名 pool item。共有不可なものは null。
//  除外: キャンセル(isCancel) / type が 'trip' 以外(休憩等)
//  含める: boardTime / pickupArea / dropoffArea / km / amount / isPickup(迎車)
//  含めない: userId / メモ / 生の boardPlace(丁目まで) / pickupKind / no
export function tripToPoolItem(trip) {
  if (!trip || trip.isCancel) return null;
  if (trip.type && trip.type !== 'trip') return null;
  return {
    boardTime: trip.boardTime || null,
    pickupArea: extractArea(trip.boardPlace || '') || null,
    dropoffArea: extractArea(trip.alightPlace || '') || null,
    km: numOrNull(trip.km),
    amount: numOrNull(trip.amount),
    isPickup: !!trip.isPickup,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-anon.js tests/group-anon.test.js
git commit -m "feat(group-anon): tripToPoolItem — 匿名pool item変換(エリア粗化/キャンセル除外)"
```

---

### Task 2: driveToPoolItems — 1日の乗車を pool items に（shareOptOut/キャンセル除外）

**Files:**
- Modify: `js/group-anon.js`
- Test: `tests/group-anon.test.js`

- [ ] **Step 1: Write the failing test**

`tests/group-anon.test.js` の末尾に追記:

```js
import { driveToPoolItems } from '../js/group-anon.js';

test('driveToPoolItems: trips を pool items に変換しキャンセルを除外', () => {
  const drive = {
    date: '2026-05-01', departureTime: '07:00', returnTime: '17:00',
    trips: [
      { type: 'trip', boardTime: '07:17', boardPlace: '大田区上池台4', alightPlace: '港区港南2', km: 6.7, amount: 3600, isPickup: true, isCancel: false },
      { type: 'trip', isCancel: true, amount: 0 },
      { type: 'trip', boardTime: '11:40', boardPlace: '江東区青海2', alightPlace: '中央区銀座8', km: 4.2, amount: 2100, isPickup: true, isCancel: false },
    ],
    rests: [{ type: 'rest', startTime: '10:00', endTime: '10:30' }],
  };
  const items = driveToPoolItems(drive);
  assert.equal(items.length, 2);
  assert.equal(items[0].pickupArea, '大田区上池台');
  assert.equal(items[1].pickupArea, '江東区青海');
});

test('driveToPoolItems: shareOptOut の日は空配列', () => {
  const drive = {
    date: '2026-05-02', shareOptOut: true,
    trips: [{ type: 'trip', boardTime: '08:00', boardPlace: '品川区', alightPlace: '港区', km: 3, amount: 1500, isPickup: false, isCancel: false }],
  };
  assert.deepEqual(driveToPoolItems(drive), []);
});

test('driveToPoolItems: trips 無し/不正でも空配列', () => {
  assert.deepEqual(driveToPoolItems({ date: '2026-05-03' }), []);
  assert.deepEqual(driveToPoolItems(null), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: FAIL（`driveToPoolItems is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-anon.js` に追記:

```js
// 1 drive → pool items[]。shareOptOut の日は空。trips 以外は無視。
export function driveToPoolItems(drive) {
  if (!drive || drive.shareOptOut) return [];
  const trips = Array.isArray(drive.trips) ? drive.trips : [];
  return trips.map(tripToPoolItem).filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-anon.js tests/group-anon.test.js
git commit -m "feat(group-anon): driveToPoolItems — shareOptOut/キャンセル除外して日→pool items"
```

---

### Task 3: buildPoolItems — 複数 drives を 1 本のバラ pool に集約

**Files:**
- Modify: `js/group-anon.js`
- Test: `tests/group-anon.test.js`

- [ ] **Step 1: Write the failing test**

`tests/group-anon.test.js` の末尾に追記:

```js
import { buildPoolItems } from '../js/group-anon.js';

test('buildPoolItems: 複数driveを平坦化しopt-out日を除外', () => {
  const drives = [
    { date: '2026-05-01', trips: [
      { type: 'trip', boardTime: '07:17', boardPlace: '大田区上池台4', alightPlace: '港区港南2', km: 6.7, amount: 3600, isPickup: true, isCancel: false },
    ]},
    { date: '2026-05-02', shareOptOut: true, trips: [
      { type: 'trip', boardTime: '08:00', boardPlace: '品川区', alightPlace: '港区', km: 3, amount: 1500, isPickup: false, isCancel: false },
    ]},
    { date: '2026-05-03', trips: [
      { type: 'trip', boardTime: '19:30', boardPlace: '中央区銀座8', alightPlace: '江東区青海2', km: 4.2, amount: 2100, isPickup: false, isCancel: false },
      { type: 'trip', isCancel: true, amount: 0 },
    ]},
  ];
  const pool = buildPoolItems(drives);
  assert.equal(pool.length, 2); // 05-01の1件 + 05-03の1件(キャンセル除外, opt-out日除外)
  assert.deepEqual(pool.map(p => p.pickupArea), ['大田区上池台', '中央区銀座']);
  // バラのtrip単位＝日付やuserIdに紐付かない（1日まとめが復元できない）
  assert.ok(pool.every(p => !('date' in p) && !('_userId' in p)));
});

test('buildPoolItems: 配列以外は空配列', () => {
  assert.deepEqual(buildPoolItems(null), []);
  assert.deepEqual(buildPoolItems(undefined), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: FAIL（`buildPoolItems is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-anon.js` に追記:

```js
// drives[] → 全 pool items[]（trip単位のバラ。日付/userIdに紐付かない）。
export function buildPoolItems(drives) {
  if (!Array.isArray(drives)) return [];
  return drives.flatMap(driveToPoolItems);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-anon.test.js`
Expected: PASS（10 tests）

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `cd ~/work/taxi-group-sharing && node --test tests/*.test.js 2>&1 | tail -5`
Expected: 全 test PASS（既存 + group-anon の10件）

- [ ] **Step 6: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-anon.js tests/group-anon.test.js
git commit -m "feat(group-anon): buildPoolItems — 複数driveをtrip単位バラpoolに集約"
```

---

## このプランの完了後

`js/group-anon.js` が以下を提供する：`tripToPoolItem` / `driveToPoolItems` / `buildPoolItems`。
プラン2（匿名化Worker）が、サービスアカウントで現メンバーの drives を読み、`buildPoolItems` で
匿名プールを構築 → `groups/{id}/pool` に再構築書き込み（min2・退会反映）する。

## Self-Review（記録）

- spec §4.1（trip単位・1日まとめ無し）→ Task1-3 が trip 単位変換で実装、Task3 テストで「date/_userId を持たない」を検証。✓
- spec §7 pool項目（boardTime/pickupArea/dropoffArea/km/amount/迎車）→ Task1 で実装。人数は trip に無いため除外（spec の「人数」は実データ非存在のため対象外、要 spec 追記）。
- spec §3 shareOptOut → Task2 で除外。✓
- キャンセル除外 → Task1/2。✓
- エリア粗化 → 既存 extractArea 再利用、Task1 で検証。✓
- placeholder/未定義参照なし。型整合（pool item の6キー）一貫。✓

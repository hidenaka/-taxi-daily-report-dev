# 匿名化Worker（グループプール再構築）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合意グループの匿名プールを「オンデマンドで再構築」する仕組みを作る。純ロジック核（直近6ヶ月絞り込み・min2ゲート・件数cap・再構築要否）＋注入式オーケストレータを TDD で実装し、既存 Cloudflare Worker(cabis-billing) に `/group-pool-refresh` エンドポイントを足す。

**Architecture:** ① 起動はオンデマンド（メンバーが分析/グループ画面を開くとクライアントが `/group-pool-refresh` を叩く。古い(builtAt>1h)時だけ再構築）。Cron不要＝Cloudflare有料プラン不要。② プールは単一ドキュメント `groups/{id}/pool/current` = `{ items:[...匿名trip], builtAt, memberCount }`。再構築＝1回上書き。③ 読み取りは各メンバーの直近6ヶ月の drives のみ。④ 安全ガード：Worker は `groups/{id}/pool/current` だけ書き、`drives`/`users`/`subscriptions` は読み取り専用。匿名化は Plan1 の `buildPoolItems` を再利用。

**Tech Stack:** Vanilla ESM JS、テスト `node --test`。Worker は既存 `worker/src/index.js`(ES Module, `export default { fetch }`) に追加。Firestore は既存 `getAccessToken`/`firestoreGet`/`firestorePatch`/値エンコードを再利用。worktree `~/work/taxi-group-sharing`（branch `feat/group-anon-sharing`）。

**前提（Explore確認済み）:**
- Plan1 で `js/group-anon.js` の `buildPoolItems(drives)` が完成済み（trip単位バラ・匿名・opt-out/キャンセル除外）。
- groups スキーマ（spec §4。Plan3 で書き込みUIを作る）: `groups/{id}` = `{ name, inviteSlug, createdBy, memberUserIds:[userId], requireContributionToView, minViewContribution, createdAt, updatedAt }`。本プランの Worker は **read のみ**。
- drive: `{ date:'YYYY-MM-DD', trips:[...], shareOptOut?:bool, ... }`。drives は `drives/{userId}/daily/{date}`。
- Worker 既存ヘルパ（index.js）: `getAccessToken(env)` / `firestoreGet(env,token,path)` / `firestorePatch(env,token,path,fields)` / `toFirestoreValue` / `firestoreBase(env)` / runQuery は直接 fetch で記述。ID Token 検証は `worker/src/auth/verify-id-token.js`。

---

### Task 1: selectRecentDrives / monthsAgoDate — 直近Nヶ月の drive に絞る（純）

**Files:**
- Create: `js/group-pool-core.js`
- Test: `tests/group-pool-core.test.js`

- [ ] **Step 1: Write the failing test**

`tests/group-pool-core.test.js` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { monthsAgoDate, selectRecentDrives } from '../js/group-pool-core.js';

test('monthsAgoDate: nowから指定月数前の YYYY-MM-DD', () => {
  assert.equal(monthsAgoDate('2026-05-30T12:00:00.000Z', 6), '2025-11-30');
});

test('selectRecentDrives: cutoff以降のdriveだけ残す', () => {
  const drives = [
    { date: '2025-10-01' }, // 6ヶ月より前 → 除外
    { date: '2025-11-30' }, // ちょうどcutoff → 含む(>=)
    { date: '2026-05-01' }, // 含む
    { date: '' },           // 不正 → 除外
    { nodate: true },       // dateなし → 除外
  ];
  const out = selectRecentDrives(drives, '2026-05-30T12:00:00.000Z', 6);
  assert.deepEqual(out.map(d => d.date), ['2025-11-30', '2026-05-01']);
});

test('selectRecentDrives: 配列以外は空配列', () => {
  assert.deepEqual(selectRecentDrives(null, '2026-05-30T00:00:00.000Z', 6), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: FAIL（`Cannot find module '../js/group-pool-core.js'`）

- [ ] **Step 3: Write minimal implementation**

`js/group-pool-core.js` を新規作成:

```js
// グループ匿名プールの再構築ロジック（純・I/Oなし）。
// Worker(オンデマンド)がこの関数群で、メンバーの drives から匿名プールを組み立てる。
import { buildPoolItems } from './group-anon.js';

// nowIso から months ヶ月前の 'YYYY-MM-DD'。drive.date の下限比較に使う。
export function monthsAgoDate(nowIso, months) {
  const d = new Date(nowIso);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// 直近 months ヶ月の drive だけを残す（date が cutoff 以上）。
export function selectRecentDrives(drives, nowIso, months) {
  if (!Array.isArray(drives)) return [];
  const cutoff = monthsAgoDate(nowIso, months);
  return drives.filter(d => d && typeof d.date === 'string' && d.date !== '' && d.date >= cutoff);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-pool-core.js tests/group-pool-core.test.js
git commit -m "feat(group-pool): selectRecentDrives/monthsAgoDate — 直近Nヶ月絞り込み"
```

---

### Task 2: buildGroupPool — min2ゲート・匿名化・件数cap（純）

**Files:**
- Modify: `js/group-pool-core.js`
- Test: `tests/group-pool-core.test.js`

- [ ] **Step 1: Write the failing test**

`tests/group-pool-core.test.js` の先頭 import を更新し（`buildGroupPool` を追加）、末尾にテスト追記:

```js
// 先頭 import に buildGroupPool を追加:
// import { monthsAgoDate, selectRecentDrives, buildGroupPool } from '../js/group-pool-core.js';

const TRIP = (boardPlace, amount) => ({ type: 'trip', boardTime: '19:00', boardPlace, alightPlace: '港区', km: 3, amount, isPickup: false, isCancel: false });

test('buildGroupPool: メンバー2人以上で匿名itemsを返す', () => {
  const drives = [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.equal(pool.memberCount, 2);
  assert.equal(pool.builtAt, '2026-05-30T00:00:00.000Z');
  assert.equal(pool.items.length, 1);
  assert.equal(pool.items[0].pickupArea, '中央区銀座');
});

test('buildGroupPool: メンバー2人未満は空プール（min2ゲート）', () => {
  const drives = [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }];
  const pool = buildGroupPool(drives, 1, { nowIso: '2026-05-30T00:00:00.000Z' });
  assert.deepEqual(pool.items, []);
  assert.equal(pool.memberCount, 1);
});

test('buildGroupPool: 直近6ヶ月外のdriveは入らない', () => {
  const drives = [
    { date: '2024-01-01', trips: [TRIP('品川区', 1000)] }, // 古い→除外
    { date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] },
  ];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z', months: 6 });
  assert.equal(pool.items.length, 1);
});

test('buildGroupPool: maxItems で件数を上限し新しい方を残す', () => {
  const trips = Array.from({ length: 5 }, (_, i) => TRIP('港区' + i, 1000 + i));
  const drives = [{ date: '2026-05-01', trips }];
  const pool = buildGroupPool(drives, 2, { nowIso: '2026-05-30T00:00:00.000Z', maxItems: 3 });
  assert.equal(pool.items.length, 3);
  // slice(末尾)で後方(新しい入力順)を残す
  assert.equal(pool.items[2].amount, 1004);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: FAIL（`buildGroupPool is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-pool-core.js` に追記:

```js
// drives + memberCount → 匿名プール {items, builtAt, memberCount}。
// メンバー2人未満は空（誰のか分からない＝匿名が成立しないため）。
// 直近 months ヶ月に絞り、maxItems を超えたら新しい方(配列後方)を残す。
export function buildGroupPool(drives, memberCount, opts = {}) {
  const { nowIso, months = 6, maxItems = 5000 } = opts;
  const mc = Number(memberCount) || 0;
  if (mc < 2) return { items: [], builtAt: nowIso, memberCount: mc };
  const recent = selectRecentDrives(drives, nowIso, months);
  let items = buildPoolItems(recent);
  if (items.length > maxItems) items = items.slice(items.length - maxItems);
  return { items, builtAt: nowIso, memberCount: mc };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-pool-core.js tests/group-pool-core.test.js
git commit -m "feat(group-pool): buildGroupPool — min2ゲート/直近6ヶ月/件数cap"
```

---

### Task 3: shouldRebuild — 再構築要否（純）

**Files:**
- Modify: `js/group-pool-core.js`
- Test: `tests/group-pool-core.test.js`

- [ ] **Step 1: Write the failing test**

先頭 import に `shouldRebuild` を追加し、末尾に追記:

```js
test('shouldRebuild: プール無しは再構築', () => {
  assert.equal(shouldRebuild(null, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
});

test('shouldRebuild: builtAt無し/不正は再構築', () => {
  assert.equal(shouldRebuild({}, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
  assert.equal(shouldRebuild({ builtAt: 'bad' }, Date.parse('2026-05-30T12:00:00Z'), 3600000), true);
});

test('shouldRebuild: ttl内はfalse、ttl超でtrue', () => {
  const now = Date.parse('2026-05-30T12:00:00Z');
  assert.equal(shouldRebuild({ builtAt: '2026-05-30T11:30:00Z' }, now, 3600000), false); // 30分前
  assert.equal(shouldRebuild({ builtAt: '2026-05-30T10:30:00Z' }, now, 3600000), true);  // 90分前
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: FAIL（`shouldRebuild is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-pool-core.js` に追記:

```js
// プールが古い(builtAt が ttlMs より前) or 無い/壊れている → 再構築すべき。
export function shouldRebuild(pool, nowMs, ttlMs) {
  if (!pool || !pool.builtAt) return true;
  const built = Date.parse(pool.builtAt);
  if (!Number.isFinite(built)) return true;
  return (nowMs - built) >= ttlMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: PASS（11 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-pool-core.js tests/group-pool-core.test.js
git commit -m "feat(group-pool): shouldRebuild — builtAt鮮度判定"
```

---

### Task 4: refreshGroupPool — 注入式オーケストレータ（純・依存注入でテスト）

**Files:**
- Modify: `js/group-pool-core.js`
- Test: `tests/group-pool-core.test.js`

- [ ] **Step 1: Write the failing test**

先頭 import に `refreshGroupPool` を追加し、末尾に追記:

```js
function makeDeps(overrides = {}) {
  const writes = [];
  const deps = {
    readGroup: async () => ({ memberUserIds: ['taro', 'hanako'] }),
    readPool: async () => null,
    readMemberDrives: async (uid) => [{ date: '2026-05-01', trips: [TRIP('中央区銀座8', 3000)] }],
    writePool: async (gid, pool) => { writes.push({ gid, pool }); },
    ...overrides,
  };
  return { deps, writes };
}
const OPTS = { nowIso: '2026-05-30T12:00:00.000Z', nowMs: Date.parse('2026-05-30T12:00:00.000Z'), ttlMs: 3600000 };

test('refreshGroupPool: 2人以上→再構築してwriteする', async () => {
  const { deps, writes } = makeDeps();
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'rebuilt');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pool.items.length, 2); // 2メンバー×1trip
  assert.equal(writes[0].pool.memberCount, 2);
});

test('refreshGroupPool: 新鮮なプールがあれば再構築しない(force=false)', async () => {
  const { deps, writes } = makeDeps({ readPool: async () => ({ builtAt: '2026-05-30T11:45:00.000Z', items: [], memberCount: 2 }) });
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'fresh');
  assert.equal(writes.length, 0);
});

test('refreshGroupPool: force=true なら新鮮でも再構築', async () => {
  const { deps, writes } = makeDeps({ readPool: async () => ({ builtAt: '2026-05-30T11:45:00.000Z', items: [], memberCount: 2 }) });
  const r = await refreshGroupPool(deps, 'g1', { ...OPTS, force: true });
  assert.equal(r.status, 'rebuilt');
  assert.equal(writes.length, 1);
});

test('refreshGroupPool: 2人未満は空プールをwrite', async () => {
  const { deps, writes } = makeDeps({ readGroup: async () => ({ memberUserIds: ['taro'] }) });
  const r = await refreshGroupPool(deps, 'g1', OPTS);
  assert.equal(r.status, 'too-few');
  assert.deepEqual(writes[0].pool.items, []);
});

test('refreshGroupPool: グループ無しは no-group・writeしない', async () => {
  const { deps, writes } = makeDeps({ readGroup: async () => null });
  const r = await refreshGroupPool(deps, 'gX', OPTS);
  assert.equal(r.status, 'no-group');
  assert.equal(writes.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: FAIL（`refreshGroupPool is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/group-pool-core.js` に追記:

```js
// 注入式オーケストレータ。実Firestoreは Worker 側で deps として渡す（テスト可能化）。
//   deps.readGroup(groupId)         -> { memberUserIds: [] } | null
//   deps.readPool(groupId)          -> pool | null
//   deps.readMemberDrives(uid, since) -> drives[]  (since='YYYY-MM-DD' 以降)
//   deps.writePool(groupId, pool)   -> Promise<void>
export async function refreshGroupPool(deps, groupId, opts = {}) {
  const { nowIso, nowMs, ttlMs = 3600000, months = 6, maxItems = 5000, force = false } = opts;
  const group = await deps.readGroup(groupId);
  if (!group) return { status: 'no-group' };
  const members = Array.isArray(group.memberUserIds) ? group.memberUserIds : [];

  if (!force) {
    const existing = await deps.readPool(groupId);
    if (!shouldRebuild(existing, nowMs, ttlMs)) {
      return { status: 'fresh', builtAt: existing.builtAt };
    }
  }
  if (members.length < 2) {
    const empty = { items: [], builtAt: nowIso, memberCount: members.length };
    await deps.writePool(groupId, empty);
    return { status: 'too-few', memberCount: members.length };
  }
  const since = monthsAgoDate(nowIso, months);
  let allDrives = [];
  for (const uid of members) {
    const drives = await deps.readMemberDrives(uid, since);
    if (Array.isArray(drives)) allDrives = allDrives.concat(drives);
  }
  const pool = buildGroupPool(allDrives, members.length, { nowIso, months, maxItems });
  await deps.writePool(groupId, pool);
  return { status: 'rebuilt', count: pool.items.length, memberCount: members.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-group-sharing && node --test tests/group-pool-core.test.js`
Expected: PASS（16 tests）

- [ ] **Step 5: Run full suite (no regressions)**

Run: `cd ~/work/taxi-group-sharing && node --test tests/*.test.js 2>&1 | tail -5`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
cd ~/work/taxi-group-sharing
git add js/group-pool-core.js tests/group-pool-core.test.js
git commit -m "feat(group-pool): refreshGroupPool — 注入式オーケストレータ(鮮度/min2/再構築)"
```

---

### Task 5: Worker配線 — Firestore deps + `/group-pool-refresh` エンドポイント

> **注意:** このタスクの実コードは書くが、**ライブ検証（dev Worker へ `wrangler deploy` + テスト用 group ドキュメント seed + エンドポイント実行）はデプロイ手順（Task 6）でユーザーと実施**。groups の作成UIは Plan3。ここでは Worker の JS を完成させ、可能なら fetch をモックした単体テストを足す。

**Files:**
- Create: `worker/src/group-pool.js`（Firestore-backed deps を構築するファクトリ）
- Modify: `worker/src/index.js`（ルート `POST /group-pool-refresh` 追加 + import）

- [ ] **Step 1: `worker/src/group-pool.js` を作成**

既存 index.js の `getAccessToken/firestoreGet/firestorePatch/firestoreBase/toFirestoreValue` を引数で受け取り、`js/group-pool-core.js` の `refreshGroupPool` 用 deps を組む。配列＋mapのエンコードはここで定義（index.js の基本 toFirestoreValue は配列非対応のため）。

```js
// Firestore-backed deps for refreshGroupPool（Cloudflare Worker用）。
// 安全ガード: ここから書くのは groups/{id}/pool/current のみ。drives/users は read のみ。
import { refreshGroupPool } from '../../js/group-pool-core.js';

// pool item / pool doc を Firestore REST の値表現にエンコード（配列・map対応）。
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encodeValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const o = {}; for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = decodeValue(val);
    return o;
  }
  if ('nullValue' in v) return null;
  return null;
}
function decodeFields(fields) {
  const o = {}; for (const [k, v] of Object.entries(fields || {})) o[k] = decodeValue(v);
  return o;
}

// env/token と index.js のヘルパを受け取り、refreshGroupPool 用 deps を返す。
export function makeFirestoreDeps({ env, token, firestoreGet, firestorePatch, firestoreBase }) {
  return {
    async readGroup(groupId) {
      const doc = await firestoreGet(env, token, 'groups/' + groupId);
      if (!doc || !doc.fields) return null;
      return decodeFields(doc.fields);
    },
    async readPool(groupId) {
      const doc = await firestoreGet(env, token, `groups/${groupId}/pool/current`);
      if (!doc || !doc.fields) return null;
      return decodeFields(doc.fields);
    },
    async readMemberDrives(userId, since) {
      // drives/{userId}/daily を date>=since で runQuery（read only）
      const url = firestoreBase(env) + ':runQuery';
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'daily' }],
            where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } },
          },
          // 親パスを drives/{userId} にするため parent を指定
          parent: `drives/${userId}`,
        }),
      });
      if (!res.ok) return [];
      const rows = await res.json();
      return (Array.isArray(rows) ? rows : []).filter(r => r.document).map(r => decodeFields(r.document.fields));
    },
    async writePool(groupId, pool) {
      // 書き込みは groups/{id}/pool/current のみ。items は配列なので encodeValue で。
      const url = firestoreBase(env) + '/groups/' + groupId + '/pool/current';
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          items: encodeValue(pool.items || []),
          builtAt: encodeValue(pool.builtAt),
          memberCount: encodeValue(pool.memberCount),
        } }),
      });
      if (!res.ok) throw new Error('writePool ' + res.status + ': ' + (await res.text()));
    },
  };
}

export { refreshGroupPool, decodeFields };
```

> 注: `firestoreBase(env)`/`runQuery` の親パス指定は既存 index.js の runQuery 実装に合わせて調整すること（index.js の `findCompanyIdByUserId` の runQuery URL/parent の書き方を踏襲）。drives は userId 配下のサブコレクション `daily` なので `parent` 指定が要る。

- [ ] **Step 2: index.js にエンドポイントを追加**

`worker/src/index.js` の import に追加:

```js
import { makeFirestoreDeps, refreshGroupPool } from './group-pool.js';
import { verifyIdToken } from './auth/verify-id-token.js';
```

fetch ルーティングに分岐を追加（既存の `if (path === ...)` 群に倣う）:

```js
if (request.method === 'POST' && path === '/group-pool-refresh') {
  return handleGroupPoolRefresh(request, env);
}
```

ハンドラ本体を追加（既存ヘルパ getAccessToken/firestoreGet/firestorePatch/firestoreBase はファイル内スコープで利用可）:

```js
async function handleGroupPoolRefresh(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const groupId = body && body.groupId;
    if (!groupId || typeof groupId !== 'string') return json(env, { error: 'groupId required' }, 400);

    // 呼び出し者の本人確認: Firebase ID Token → uid
    const authz = request.headers.get('Authorization') || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return json(env, { error: 'unauthorized' }, 401);
    const claims = await verifyIdToken(idToken, env.FIREBASE_PROJECT_ID).catch(() => null);
    if (!claims || !claims.sub) return json(env, { error: 'unauthorized' }, 401);

    const token = await getAccessToken(env);

    // uid → userId（users/{uid}.userId）
    const userDoc = await firestoreGet(env, token, 'users/' + claims.sub);
    const myUserId = userDoc && userDoc.fields && userDoc.fields.userId && userDoc.fields.userId.stringValue;
    if (!myUserId) return json(env, { error: 'no-user' }, 403);

    const deps = makeFirestoreDeps({ env, token, firestoreGet, firestorePatch, firestoreBase });

    // 呼び出し者がメンバーか確認（部外者の再構築要求を拒否）
    const group = await deps.readGroup(groupId);
    if (!group) return json(env, { error: 'no-group' }, 404);
    const members = Array.isArray(group.memberUserIds) ? group.memberUserIds : [];
    if (!members.includes(myUserId)) return json(env, { error: 'not-a-member' }, 403);

    const now = new Date();
    const result = await refreshGroupPool(deps, groupId, {
      nowIso: now.toISOString(), nowMs: now.getTime(), ttlMs: 3600000, months: 6, maxItems: 5000,
      force: !!(body && body.force),
    });
    return json(env, { ok: true, ...result });
  } catch (err) {
    console.error('group-pool-refresh error:', (err && err.stack) || err);
    return json(env, { error: 'internal' }, 500);
  }
}
```

> `json(env, obj, status)` と CORS は既存ヘルパに合わせる（既存エンドポイントと同じ書式）。`ALLOWED_ORIGIN` の CORS も他エンドポイント同様に通す。

- [ ] **Step 3: 構文チェック**

Run: `cd ~/work/taxi-group-sharing && node --check worker/src/group-pool.js && node --check worker/src/index.js`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-group-sharing
git add worker/src/group-pool.js worker/src/index.js
git commit -m "feat(worker): /group-pool-refresh — オンデマンド匿名プール再構築(メンバー検証付き)"
```

---

### Task 6: デプロイ & dev ライブ検証（ユーザーと実施・Plan3後）

> このタスクは wrangler 認証とシークレットが要るため、実装者は**手順を提示**し、ユーザーが実行する。groups 作成UIは Plan3 だが、dev で手動 seed して先行検証してもよい。

- [ ] **Step 1: wrangler.toml**（Cron は不要＝追記なし。オンデマンドのため `[triggers]` は足さない）。CORS の `ALLOWED_ORIGIN` は既存のままで可。

- [ ] **Step 2: dev デプロイ**（ユーザー実行）

```bash
cd ~/work/taxi-group-sharing/worker && npm run deploy   # cabis-billing-dev
```

- [ ] **Step 3: テスト用 group を dev Firestore に seed**（ユーザー or Plan3 のUIで作成）

`groups/testg1` = `{ memberUserIds: ['<自分のuserId>', '<もう1人>'], name:'test', ... }`

- [ ] **Step 4: エンドポイント実行（ログイン中ブラウザの kimi-webbridge から、自分の ID Token 付きで）**

```
POST https://cabis-billing-dev.<...>.workers.dev/group-pool-refresh
Authorization: Bearer <Firebase ID token>
{ "groupId": "testg1", "force": true }
```

期待: `{ ok:true, status:'rebuilt', count:N }`。`groups/testg1/pool/current` に `items` 配列が書かれ、`drives` は不変であることを Firestore コンソールで確認。

- [ ] **Step 5: 安全確認**：`drives`/`users`/`subscriptions` が一切書き換わっていないこと。非メンバーの ID Token では 403 になること。

---

## このプラン完了後

`js/group-pool-core.js`（純・全テスト済）＋ `worker/src/group-pool.js` ＋ `/group-pool-refresh`（メンバー検証付きオンデマンド再構築）が揃う。
Plan3（グループ作成/参加UI＋ルール）で groups が実際に作られ、Plan4（分析UI）が画面表示時にこのエンドポイントを叩いてプールを表示する。

## Self-Review（記録）

- spec ①オンデマンド → Task5 エンドポイント＋shouldRebuild(Task3)。✓
- spec ②単一ドキュメント pool → writePool が groups/{id}/pool/current に1回PATCH。✓
- spec ③直近6ヶ月 → selectRecentDrives/monthsAgoDate(Task1)＋readMemberDrives の date>=since クエリ。✓
- spec min2 → buildGroupPool/refreshGroupPool(Task2,4)。✓
- 安全ガード（pool/current のみ書く・drives等read only） → makeFirestoreDeps と handler。Task6 Step5 で実地確認。✓
- 匿名化は Plan1 buildPoolItems 再利用。✓
- placeholder: Task5 の `firestoreBase`/runQuery parent 指定は「既存 index.js に合わせ調整」と注記（実装者が既存実装を読んで合わせる）。型整合: pool は {items,builtAt,memberCount} で全タスク一貫。

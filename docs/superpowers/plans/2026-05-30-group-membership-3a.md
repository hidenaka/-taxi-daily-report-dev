# Plan 3a: グループ作成/参加/退会の基盤（ルール＋Worker）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** グループの作成・参加・退会を「Worker仲介」で安全に行う基盤を作る。純ロジック（メンバー配列操作＋注入式 create/join/leave オーケストレータ）を TDD で実装し、Worker に `/group-create` `/group-join` `/group-leave` を足し、Firestore ルールで groups/pool を「メンバーreadのみ・書込はWorkerのみ」に縛る。

**Architecture:** 加盟書き込みはクライアントに許さず Worker(サービスアカウント)経由（ID Token検証→本人userIdのみ操作）。groups/{id} と groups/{id}/pool/* は **read=当該グループのメンバーのみ／write=false（Workerのみ）**。create=自分を唯一メンバーにした新doc、join=招待slugでgroupを引き memberUserIds に自分を追加、leave=自分を除去（空なら group と pool を削除）。匿名プール生成は Plan2 の `/group-pool-refresh`。

**Tech Stack:** Vanilla ESM JS、`node --test`。Worker は既存 `worker/src/index.js` に追加（getAccessToken/firestoreGet/firestorePatch/firestoreBase/runQuery/json/corsHeaders/verifyFirebaseIdToken を再利用）。slug は `js/slug-gen.js` の `generateSlug('gr-',6,rng)`。worktree `~/work/taxi-group-sharing`（branch feat/group-anon-sharing）。

**前提（確認済み）:**
- `generateSlug(prefix='co-', length=6, rng=Math.random)` → 'co-xxxxxx'。groups は 'gr-'。
- `verifyFirebaseIdToken(idToken, projectId)` → `{ uid }`。
- groups スキーマ(spec §4): `{ name, inviteSlug, createdBy, memberUserIds:[userId], requireContributionToView, minViewContribution, createdAt, updatedAt }`。
- 既存ルール helper: `myUserId()` = `get(users/$(uid)).data.userId`、`isSignedIn()`。
- Plan2 で `worker/src/group-pool.js`（encodeValue/decodeValue/decodeFields, drivesQueryParent）作成済み＝再利用可。

---

### Task 1: newGroupDoc — 新規グループdoc初期値（純）

**Files:** Create `js/group-membership.js` / Test `tests/group-membership.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { newGroupDoc } from '../js/group-membership.js';

test('newGroupDoc: 作成者のみメンバー・既定値', () => {
  const doc = newGroupDoc({ name: '夜勤仲間', createdBy: 'taro', inviteSlug: 'gr-abc123', nowIso: '2026-05-30T00:00:00.000Z' });
  assert.deepEqual(doc.memberUserIds, ['taro']);
  assert.equal(doc.createdBy, 'taro');
  assert.equal(doc.inviteSlug, 'gr-abc123');
  assert.equal(doc.name, '夜勤仲間');
  assert.equal(doc.requireContributionToView, false);
  assert.equal(doc.minViewContribution, 1);
  assert.equal(doc.createdAt, '2026-05-30T00:00:00.000Z');
  assert.equal(doc.updatedAt, '2026-05-30T00:00:00.000Z');
});

test('newGroupDoc: name空はデフォルト名・50字に丸め・閲覧条件指定可', () => {
  const doc = newGroupDoc({ name: '', createdBy: 'a', inviteSlug: 'gr-x', nowIso: '2026-01-01T00:00:00.000Z', requireContributionToView: true, minViewContribution: 3 });
  assert.equal(doc.name, 'グループ');
  assert.equal(doc.requireContributionToView, true);
  assert.equal(doc.minViewContribution, 3);
  const long = newGroupDoc({ name: 'あ'.repeat(80), createdBy: 'a', inviteSlug: 'gr-y', nowIso: '2026-01-01T00:00:00.000Z' });
  assert.equal(long.name.length, 50);
});
```

- [ ] **Step 2: 失敗確認** `cd ~/work/taxi-group-sharing && node --test tests/group-membership.test.js` → FAIL（module無し）

- [ ] **Step 3: 実装**

```js
// グループのメンバー操作・作成/参加/退会の純ロジック。I/Oなし。
// 実Firestoreは Worker 側で deps として注入する（テスト可能化）。
import { generateSlug } from './slug-gen.js';

// 新規グループの初期ドキュメント。作成者を唯一のメンバーにする。
export function newGroupDoc({ name, createdBy, inviteSlug, nowIso, requireContributionToView = false, minViewContribution = 1 }) {
  return {
    name: ((name || '').slice(0, 50)) || 'グループ',
    inviteSlug,
    createdBy,
    memberUserIds: [createdBy],
    requireContributionToView: !!requireContributionToView,
    minViewContribution: Number(minViewContribution) || 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
```

- [ ] **Step 4: 成功確認** → PASS（2 tests）
- [ ] **Step 5: Commit** `git add js/group-membership.js tests/group-membership.test.js && git commit -m "feat(group-membership): newGroupDoc — 新規グループ初期doc"`

---

### Task 2: addMember / removeMember / newGroupSlug（純）

**Files:** Modify `js/group-membership.js` / Test 同上

- [ ] **Step 1: 失敗テスト**（先頭importに addMember, removeMember, newGroupSlug 追加）

```js
test('addMember: 追加・重複なし・非破壊', () => {
  const a = ['taro'];
  assert.deepEqual(addMember(a, 'hanako'), ['taro', 'hanako']);
  assert.deepEqual(addMember(a, 'taro'), ['taro']); // 重複追加しない
  assert.deepEqual(a, ['taro']); // 元配列は不変
  assert.deepEqual(addMember(null, 'x'), ['x']); // 非配列安全
});

test('removeMember: 除去・非破壊・非配列安全', () => {
  const a = ['taro', 'hanako'];
  assert.deepEqual(removeMember(a, 'taro'), ['hanako']);
  assert.deepEqual(a, ['taro', 'hanako']);
  assert.deepEqual(removeMember(null, 'x'), []);
});

test('newGroupSlug: gr- 接頭辞・決定的rngで再現', () => {
  let i = 0;
  const rng = () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6][i++ % 6];
  const s = newGroupSlug(rng);
  assert.ok(s.startsWith('gr-'));
  assert.equal(s.length, 'gr-'.length + 6);
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装**（追記）

```js
// userId を memberUserIds に追加（重複なし・非破壊）。
export function addMember(memberUserIds, userId) {
  const arr = Array.isArray(memberUserIds) ? memberUserIds : [];
  return arr.includes(userId) ? arr.slice() : [...arr, userId];
}

// userId を memberUserIds から除去（非破壊）。
export function removeMember(memberUserIds, userId) {
  const arr = Array.isArray(memberUserIds) ? memberUserIds : [];
  return arr.filter((u) => u !== userId);
}

// グループ用招待slug（gr- 接頭辞・6文字）。
export function newGroupSlug(rng) {
  return generateSlug('gr-', 6, rng);
}
```

- [ ] **Step 4: 成功確認** → PASS（5 tests）
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(group-membership): addMember/removeMember/newGroupSlug"`

---

### Task 3: createGroupOp / joinGroupOp / leaveGroupOp — 注入式オーケストレータ（純）

**Files:** Modify `js/group-membership.js` / Test 同上

deps 契約:
- `deps.slugExists(slug)` -> bool（衝突チェック）
- `deps.writeGroup(groupId, doc)` -> Promise<void>（新規作成。groupId は呼び出し側生成）
- `deps.findGroupBySlug(slug)` -> `{ groupId, group }` | null
- `deps.updateMembers(groupId, memberUserIds, nowIso)` -> Promise<void>
- `deps.deleteGroup(groupId)` -> Promise<void>（pool含め削除）

- [ ] **Step 1: 失敗テスト**（先頭importに createGroupOp, joinGroupOp, leaveGroupOp 追加）

```js
function mkDeps(over = {}) {
  const calls = { writeGroup: [], updateMembers: [], deleteGroup: [] };
  const deps = {
    slugExists: async () => false,
    writeGroup: async (gid, doc) => { calls.writeGroup.push({ gid, doc }); },
    findGroupBySlug: async (slug) => ({ groupId: 'g1', group: { memberUserIds: ['taro'], inviteSlug: slug } }),
    updateMembers: async (gid, members, nowIso) => { calls.updateMembers.push({ gid, members, nowIso }); },
    deleteGroup: async (gid) => { calls.deleteGroup.push(gid); },
    ...over,
  };
  return { deps, calls };
}
const NOW = '2026-05-30T00:00:00.000Z';

test('createGroupOp: slug衝突を避け新groupを書く', async () => {
  const { deps, calls } = mkDeps();
  let n = 0;
  const r = await createGroupOp(deps, { userId: 'taro', name: '仲間', nowIso: NOW, genSlug: () => ['gr-aaa', 'gr-bbb'][n++] });
  assert.equal(calls.writeGroup.length, 1);
  assert.deepEqual(calls.writeGroup[0].doc.memberUserIds, ['taro']);
  assert.ok(r.groupId);
  assert.ok(r.inviteSlug.startsWith('gr-'));
});

test('createGroupOp: slug衝突時は再生成', async () => {
  let exists = 0;
  const { deps } = mkDeps({ slugExists: async () => (exists++ === 0) }); // 1回目だけ衝突
  let n = 0;
  const r = await createGroupOp(deps, { userId: 'taro', name: 'x', nowIso: NOW, genSlug: () => ['gr-dup', 'gr-ok'][n++] });
  assert.equal(r.inviteSlug, 'gr-ok');
});

test('joinGroupOp: slugでgroupを引き自分を追加', async () => {
  const { deps, calls } = mkDeps();
  const r = await joinGroupOp(deps, { userId: 'hanako', slug: 'gr-abc', nowIso: NOW });
  assert.equal(r.status, 'joined');
  assert.equal(r.groupId, 'g1');
  assert.deepEqual(calls.updateMembers[0].members, ['taro', 'hanako']);
});

test('joinGroupOp: 既メンバーは二重追加しない(already)', async () => {
  const { deps, calls } = mkDeps({ findGroupBySlug: async () => ({ groupId: 'g1', group: { memberUserIds: ['taro'] } }) });
  const r = await joinGroupOp(deps, { userId: 'taro', slug: 'gr-abc', nowIso: NOW });
  assert.equal(r.status, 'already');
  assert.equal(calls.updateMembers.length, 0);
});

test('joinGroupOp: slug不正/group無しは no-group', async () => {
  const { deps } = mkDeps({ findGroupBySlug: async () => null });
  const r = await joinGroupOp(deps, { userId: 'x', slug: 'gr-zzz', nowIso: NOW });
  assert.equal(r.status, 'no-group');
});

test('leaveGroupOp: 自分を除去・残ればupdateMembers', async () => {
  const { deps, calls } = mkDeps({ findGroupBySlug: async () => null });
  const r = await leaveGroupOp(deps, { userId: 'hanako', groupId: 'g1', nowIso: NOW, group: { memberUserIds: ['taro', 'hanako'] } });
  assert.equal(r.status, 'left');
  assert.deepEqual(calls.updateMembers[0].members, ['taro']);
  assert.equal(calls.deleteGroup.length, 0);
});

test('leaveGroupOp: 最後の1人が抜けたらgroup削除', async () => {
  const { deps, calls } = mkDeps();
  const r = await leaveGroupOp(deps, { userId: 'taro', groupId: 'g1', nowIso: NOW, group: { memberUserIds: ['taro'] } });
  assert.equal(r.status, 'deleted');
  assert.equal(calls.deleteGroup[0], 'g1');
  assert.equal(calls.updateMembers.length, 0);
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装**（追記）

```js
// 作成: 衝突しない slug を引き当て、作成者のみメンバーの group を書く。
// deps.slugExists / deps.writeGroup を使う。genSlug() は slug 文字列を返す関数（注入でテスト可能）。
// groupId は slug をそのまま使う（gr-XXXXXX はランダムで一意性高い）。
export async function createGroupOp(deps, { userId, name, nowIso, requireContributionToView, minViewContribution, genSlug }) {
  let slug = genSlug();
  let guard = 0;
  while ((await deps.slugExists(slug)) && guard++ < 5) slug = genSlug();
  const groupId = slug; // slug を ID に流用
  const doc = newGroupDoc({ name, createdBy: userId, inviteSlug: slug, nowIso, requireContributionToView, minViewContribution });
  await deps.writeGroup(groupId, doc);
  return { groupId, inviteSlug: slug };
}

// 参加: slug から group を引き、自分を memberUserIds に追加。
export async function joinGroupOp(deps, { userId, slug, nowIso }) {
  const found = await deps.findGroupBySlug(slug);
  if (!found) return { status: 'no-group' };
  const members = Array.isArray(found.group.memberUserIds) ? found.group.memberUserIds : [];
  if (members.includes(userId)) return { status: 'already', groupId: found.groupId };
  const next = addMember(members, userId);
  await deps.updateMembers(found.groupId, next, nowIso);
  return { status: 'joined', groupId: found.groupId };
}

// 退会: 自分を除去。残り0なら group(とpool) を削除。
//   group は呼び出し側(Worker)が読んで渡す（{memberUserIds}）。
export async function leaveGroupOp(deps, { userId, groupId, nowIso, group }) {
  const members = Array.isArray(group && group.memberUserIds) ? group.memberUserIds : [];
  if (!members.includes(userId)) return { status: 'not-a-member' };
  const next = removeMember(members, userId);
  if (next.length === 0) {
    await deps.deleteGroup(groupId);
    return { status: 'deleted' };
  }
  await deps.updateMembers(groupId, next, nowIso);
  return { status: 'left' };
}
```

- [ ] **Step 4: 成功確認** → PASS（12 tests）
- [ ] **Step 5: 全スイート** `node --test tests/*.test.js 2>&1 | tail -5` → 全PASS
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(group-membership): create/join/leave 注入式オーケストレータ"`

---

### Task 4: Worker配線 — `/group-create` `/group-join` `/group-leave`

> ライブ検証は Task 6（デプロイ要）。ここは Worker JS を書き構文チェックまで。安全ガード：書き込みは groups/{id} と groups/{id}/pool/current（削除時）のみ。drives/users は read のみ。

**Files:** Create `worker/src/group-membership.js` / Modify `worker/src/index.js`

- [ ] **Step 1: まず既存を読む** `worker/src/index.js`（getAccessToken/firestoreGet/firestorePatch/firestoreBase/json/corsHeaders/runQuery書式）, `worker/src/group-pool.js`（encodeValue/decodeFields/drivesQueryParent—再利用）, `worker/src/auth/verify-id-token.js`（verifyFirebaseIdToken）。

- [ ] **Step 2: `worker/src/group-membership.js` を作成**

`js/group-membership.js` のオーケストレータ用に Firestore-backed deps を構築。`worker/src/group-pool.js` の `encodeValue`（配列/map対応）と `decodeFields` を import 再利用（重複実装しない）。

```js
import { createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug } from '../../js/group-membership.js';
import { encodeValue, decodeFields } from './group-pool.js';

// 既存 index.js のヘルパ(env, token, firestoreGet, firestorePatch, firestoreBase)を受けて deps を返す。
export function makeMembershipDeps({ env, token, firestoreGet, firestorePatch, firestoreBase }) {
  const base = firestoreBase(env);
  return {
    async slugExists(slug) {
      const doc = await firestoreGet(env, token, 'groups/' + slug);
      return !!(doc && doc.fields);
    },
    async writeGroup(groupId, docObj) {
      // 新規作成 = groups/{groupId} に PATCH（全フィールド）
      const url = base + '/groups/' + groupId;
      const fields = {};
      for (const [k, v] of Object.entries(docObj)) fields[k] = encodeValue(v);
      const res = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
      if (!res.ok) throw new Error('writeGroup ' + res.status + ': ' + (await res.text()));
    },
    async findGroupBySlug(slug) {
      // groupId=slug 運用なので直接 GET（createGroupOp が slug を ID に流用）
      const doc = await firestoreGet(env, token, 'groups/' + slug);
      if (!doc || !doc.fields) return null;
      return { groupId: slug, group: decodeFields(doc.fields) };
    },
    async updateMembers(groupId, members, nowIso) {
      // memberUserIds と updatedAt だけ更新（updateMask）
      const mask = 'updateMask.fieldPaths=memberUserIds&updateMask.fieldPaths=updatedAt';
      const url = base + '/groups/' + groupId + '?' + mask;
      const res = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { memberUserIds: encodeValue(members), updatedAt: encodeValue(nowIso) } }) });
      if (!res.ok) throw new Error('updateMembers ' + res.status + ': ' + (await res.text()));
    },
    async deleteGroup(groupId) {
      // pool/current を先に削除 → group 本体削除
      await fetch(base + '/groups/' + groupId + '/pool/current', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      const res = await fetch(base + '/groups/' + groupId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok && res.status !== 404) throw new Error('deleteGroup ' + res.status);
    },
  };
}

export { createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug };
```

- [ ] **Step 3: index.js にルート3つ追加**

import 追加:
```js
import { makeMembershipDeps, createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug } from './group-membership.js';
```

ルーティング（既存群に倣う）:
```js
if (request.method === 'POST' && path === '/group-create') return handleGroupCreate(request, env);
if (request.method === 'POST' && path === '/group-join')   return handleGroupJoin(request, env);
if (request.method === 'POST' && path === '/group-leave')  return handleGroupLeave(request, env);
```

共通: ID Token → userId を取る小ヘルパ（既存 handleGroupPoolRefresh と同じ手順を関数化してもよい）。各ハンドラ:

```js
// 共通: Authorization の ID Token から自分の userId を解決（無ければ null）
async function resolveMyUserId(request, env, token) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!idToken) return null;
  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID).catch(() => null);
  if (!claims || !claims.uid) return null;
  const userDoc = await firestoreGet(env, token, 'users/' + claims.uid);
  return (userDoc && userDoc.fields && userDoc.fields.userId && userDoc.fields.userId.stringValue) || null;
}

async function handleGroupCreate(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestorePatch, firestoreBase });
    const r = await createGroupOp(deps, { userId: myUserId, name: body && body.name, nowIso: new Date().toISOString(),
      requireContributionToView: !!(body && body.requireContributionToView), minViewContribution: body && body.minViewContribution,
      genSlug: () => newGroupSlug() });
    return json(env, { ok: true, ...r });
  } catch (err) { console.error('group-create error:', (err && err.stack) || err); return json(env, { error: 'internal' }, 500); }
}

async function handleGroupJoin(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const slug = body && body.slug;
    if (!slug || typeof slug !== 'string') return json(env, { error: 'slug required' }, 400);
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestorePatch, firestoreBase });
    const r = await joinGroupOp(deps, { userId: myUserId, slug, nowIso: new Date().toISOString() });
    const status = r.status === 'no-group' ? 404 : 200;
    return json(env, { ok: r.status !== 'no-group', ...r }, status);
  } catch (err) { console.error('group-join error:', (err && err.stack) || err); return json(env, { error: 'internal' }, 500); }
}

async function handleGroupLeave(request, env) {
  try {
    const token = await getAccessToken(env);
    const myUserId = await resolveMyUserId(request, env, token);
    if (!myUserId) return json(env, { error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const groupId = body && body.groupId;
    if (!groupId || typeof groupId !== 'string') return json(env, { error: 'groupId required' }, 400);
    const deps = makeMembershipDeps({ env, token, firestoreGet, firestorePatch, firestoreBase });
    const found = await deps.findGroupBySlug(groupId); // groupId=slug 運用
    if (!found) return json(env, { error: 'no-group' }, 404);
    const r = await leaveGroupOp(deps, { userId: myUserId, groupId, nowIso: new Date().toISOString(), group: found.group });
    return json(env, { ok: true, ...r });
  } catch (err) { console.error('group-leave error:', (err && err.stack) || err); return json(env, { error: 'internal' }, 500); }
}
```

- [ ] **Step 4: 構文チェック** `node --check worker/src/group-membership.js && node --check worker/src/index.js`
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(worker): /group-create //group-join //group-leave (Worker仲介・本人のみ操作)"`

---

### Task 5: Firestore ルール — groups / pool（メンバーread・write不可）

**Files:** Modify `firestore.rules`

- [ ] **Step 1: ルール追記**（既存 helper `isSignedIn()` `myUserId()` を使う。`// Everything else: deny` の直前に追加）

```
    // --- groups/{groupId} ---
    // メンバーのみ閲覧（人数・設定の表示用）。書き込みは Worker(サービスアカウント)のみ＝クライアント不可。
    match /groups/{groupId} {
      allow read: if isSignedIn() && (myUserId() in resource.data.memberUserIds);
      allow write: if false;
    }

    // --- groups/{groupId}/pool/{doc} ---
    // 当該グループのメンバーのみ閲覧。書き込みは Worker のみ。
    match /groups/{groupId}/pool/{doc} {
      allow read: if isSignedIn()
        && (myUserId() in get(/databases/$(database)/documents/groups/$(groupId)).data.memberUserIds);
      allow write: if false;
    }
```

- [ ] **Step 2: 構文目視**（rules はローカルlintなし。ブレース対応と helper 名を確認）。`isSignedIn()`/`myUserId()` が既存定義にあることを `grep -n "function myUserId\|function isSignedIn" firestore.rules` で確認。
- [ ] **Step 3: Commit** `git add firestore.rules && git commit -m "feat(rules): groups/pool はメンバーreadのみ・書込はWorkerのみ"`

---

### Task 6: デプロイ & 実地検証（ユーザーと実施）

> wrangler 認証＋firebase CLI 要。実装者は手順提示、ユーザー実行。

- [ ] dev Worker デプロイ: `cd worker && npm run deploy`
- [ ] ルール dev デプロイ: `firebase deploy --only firestore:rules`（dev project）
- [ ] kimi-webbridge でログイン中の自分の ID Token を取得し:
  - `POST /group-create {name:'test'}` → `{groupId, inviteSlug}` を確認、Firestore に groups/{slug} ができ memberUserIds=[自分] であること。
  - 別アカ(または2人目)で `POST /group-join {slug}` → memberUserIds が2人に。
  - `POST /group-leave {groupId}` → 自分が抜ける／最後の1人なら groups と pool/current が消える。
  - 非メンバー/未ログインで各エンドポイントが 401/403/404 になること。
  - **drives/users/subscriptions が書き換わっていないこと**を確認。
- [ ] その後 Plan2 の `/group-pool-refresh` を 2人グループで叩き、`groups/{id}/pool/current` に匿名 items が入ることを確認（Plan2 Task6 と統合）。

---

## このプラン完了後
groups の作成/参加/退会が Worker 仲介で安全に動き、ルールで非メンバーを遮断。Plan3b（groups.html UI）がこれらのエンドポイントを叩く。Plan3c（日報オプトアウト）は独立。

## Self-Review（記録）
- Worker仲介（クライアント書込不可） → Task5 rules write:false ＋ Task4 endpoints。✓
- 本人のみ操作 → resolveMyUserId で自分の userId のみ。create=自分, join=自分追加, leave=自分除去。✓
- 退会で空なら group+pool 削除 → leaveGroupOp + deps.deleteGroup（pool/current も）。✓
- メンバーread → rules の `myUserId() in memberUserIds`。✓
- 安全ガード（書込先 groups/{id}・pool/current のみ、drives/users read のみ） → makeMembershipDeps の fetch を確認（Task4 レビューで列挙）。✓
- placeholder: runQuery 不使用（groupId=slug 運用で GET 直引き）。型整合: status 文字列（joined/already/no-group/left/deleted/not-a-member）一貫。

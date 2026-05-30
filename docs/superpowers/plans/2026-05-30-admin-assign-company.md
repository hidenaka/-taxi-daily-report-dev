# admin「ユーザーを会社に所属させる」機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin画面の既存ユーザー管理テーブル（uid行）に「会社」列＋会社プルダウン＋適用ボタンを追加し、uid単位で `users/{uid}.companyId` を設定/解除できるようにする（無償会社なら恒久無料アクセスも同時付与）。

**Architecture:** 書き込み判断は純関数モジュール `js/admin-assign-company.js` に分離してユニットテスト。データ層は `js/firebase-storage.js` に `adminSetUserCompany` を追加し `listAllUsersWithStats` に companyId/lastActivityAt を補う。UIは既存 admin.html のユーザー表を拡張（DOM/Firestore はスモーク検証）。

**Tech Stack:** Vanilla ESM、`node --test`（tests/run.js）、Firebase client SDK（admin Firestore Rules下）、既存の無償付与ヘルパ（adminGetSubscription / adminBuildSubscriptionPayload / adminSaveSubscription）再利用。

**基準:** dev/main @ `f3a8dc551`、確認日 2026-05-30。ブランチ `feat/admin-assign-company`。spec: `docs/superpowers/specs/2026-05-30-admin-assign-company-design.md`。

**前提（調査済み）:**
- `admin.html` は SW 素通し（`sw.js` が `/admin.html` を bypass）。import は `'./js/x.js?v=N'` 形式で sw-precache-imports.test の対象外。
- ユーザー表は `listAllUsersWithStats()`（firebase-storage.js:694）で取得。現状 `{uid,userId,isAnonymous,createdAt,active,role}` を返し **companyId/lastActivityAt を含まない**。
- 会社一覧は `adminListCompanies()`（firebase-storage.js）→ `[{id, freeForInvited?, ...}]`。
- 無償付与ヘルパと `adminListCompanies` は admin.html で既に import 済み（363/369行）。

---

## File Structure

- Create: `js/admin-assign-company.js` — 純関数 `buildAssignActions` / `formatAssignConfirm`。
- Create: `tests/admin-assign-company.test.js` — 純関数テスト。
- Modify: `js/firebase-storage.js` — `listAllUsersWithStats` に companyId/lastActivityAt 追加、`adminSetUserCompany` 追加、`updateDoc` import 確認。
- Modify: `admin.html` — ユーザー表に会社/最終利用日列＋select＋適用ボタン＋ハンドラ。`admin-assign-company.js` を import、`adminSetUserCompany` を import 追加。
- Modify: `sw.js` — `./js/admin-assign-company.js` を STATIC_FILES に追加、`CACHE_NAME` bump（admin系jsを precache する既存方針に合わせる）。

---

## Task 1: 純関数モジュール `admin-assign-company.js`

**Files:**
- Create: `js/admin-assign-company.js`
- Test: `tests/admin-assign-company.test.js`

- [ ] **Step 1: Write the failing test**

`tests/admin-assign-company.test.js`:

```js
import { test, assert } from './run.js';
import { buildAssignActions, formatAssignConfirm } from '../js/admin-assign-company.js';

const USER = { uid: 'AbCdEf1234567', userId: 'user_self', companyId: null };

test('buildAssignActions: slug + freeForInvited:true → companyId設定・grantFree:true', () => {
  const a = buildAssignActions(USER, 'co-7q7ros', { id: 'co-7q7ros', freeForInvited: true });
  assert.equal(a.companyId, 'co-7q7ros');
  assert.equal(a.grantFree, true);
  assert.equal(a.cleared, false);
  assert.equal(a.uid, 'AbCdEf1234567');
  assert.equal(a.userId, 'user_self');
});

test('buildAssignActions: slug だが無償でない/companyDoc無し → grantFree:false', () => {
  assert.equal(buildAssignActions(USER, 'co-abc', { id: 'co-abc' }).grantFree, false);
  assert.equal(buildAssignActions(USER, 'co-abc', null).grantFree, false);
});

test('buildAssignActions: __none__/空/null はクリア', () => {
  for (const v of ['__none__', '', null, undefined]) {
    const a = buildAssignActions(USER, v, null);
    assert.equal(a.companyId, null);
    assert.equal(a.grantFree, false);
    assert.equal(a.cleared, true);
  }
});

test('formatAssignConfirm: 割当・無償・クリアで文言が変わる', () => {
  const assign = buildAssignActions(USER, 'co-7q7ros', { id: 'co-7q7ros', freeForInvited: true });
  const tAssign = formatAssignConfirm(USER, assign);
  assert.ok(tAssign.includes('co-7q7ros'), '会社slugを含む');
  assert.ok(tAssign.includes('無償'), '無償付与の注記を含む');

  const plain = buildAssignActions(USER, 'co-abc', { id: 'co-abc' });
  assert.ok(!formatAssignConfirm(USER, plain).includes('無償'), '無償でない時は注記なし');

  const cleared = buildAssignActions(USER, '__none__', null);
  assert.ok(formatAssignConfirm(USER, cleared).includes('解除'), 'クリアは解除文言');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/admin-assign-company.test.js`
Expected: FAIL（モジュール未作成 / 関数未定義）

- [ ] **Step 3: Write minimal implementation**

`js/admin-assign-company.js`:

```js
// admin「ユーザーを会社に所属させる」純ロジック。DOM/Firestore に触れない（テスト可能）。

// 割り当て/解除の書き込み計画を返す。
// userDoc: { uid, userId, companyId?, ... } 対象ユーザー行のデータ
// targetSlug: 会社slug。'__none__' / '' / null / undefined はクリア（所属解除）。
// companyDoc: companies一覧から見つけた該当会社 { id, freeForInvited? } または null
// 返り値: { uid, userId, companyId: string|null, grantFree: boolean, cleared: boolean }
export function buildAssignActions(userDoc, targetSlug, companyDoc) {
  const slug = (targetSlug && targetSlug !== '__none__') ? String(targetSlug) : null;
  return {
    uid: userDoc.uid,
    userId: userDoc.userId,
    companyId: slug,
    grantFree: Boolean(slug) && companyDoc?.freeForInvited === true,
    cleared: slug === null
  };
}

// 確認ダイアログ用の文言。
export function formatAssignConfirm(userDoc, actions) {
  const who = `${userDoc.userId}（uid:${String(userDoc.uid).slice(0, 8)}）`;
  if (actions.cleared) {
    return `${who} の会社所属を解除します。よろしいですか？`;
  }
  const free = actions.grantFree ? '\n＋ この会社は無償のため、恒久無料アクセスも付与します。' : '';
  return `${who} を会社「${actions.companyId}」に所属させます。${free}\nよろしいですか？`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/admin-assign-company.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add js/admin-assign-company.js tests/admin-assign-company.test.js
git commit -m "feat(admin): pure buildAssignActions/formatAssignConfirm + tests"
```

---

## Task 2: データ層 `firebase-storage.js`（companyId補完 ＋ adminSetUserCompany）

**Files:**
- Modify: `js/firebase-storage.js`（`listAllUsersWithStats` の userMap、新関数追加、import確認）

- [ ] **Step 1: `listAllUsersWithStats` の userMap に companyId/lastActivityAt を追加**

`js/firebase-storage.js` の `listAllUsersWithStats`（694行付近）の userMap 生成箇所を変更:

```js
        userMap[data.userId] = {
          uid: d.id,
          userId: data.userId,
          isAnonymous: data.isAnonymous || false,
          createdAt: data.createdAt || null,
          active: data.active !== false,
          role: 'member',
          companyId: data.companyId || null,
          lastActivityAt: data.lastActivityAt || null
        };
```

（既存の `uid, userId, isAnonymous, createdAt, active, role` の行に `companyId` と `lastActivityAt` の2行を足すだけ。）

- [ ] **Step 2: `updateDoc` が import されているか確認し、無ければ追加**

`js/firebase-storage.js` 冒頭の firebase-firestore import に `updateDoc` が含まれるか確認:

Run: `cd ~/work/taxi-dev && grep -n "updateDoc" js/firebase-storage.js | head -3`
含まれていなければ、既存の `import { ... } from '...firebase-firestore.js'` に `updateDoc` を追加する。

- [ ] **Step 3: `adminSetUserCompany` を追加**

`js/firebase-storage.js` の `adminSaveCompany`（253行付近）の直後に追加:

```js
// Admin: ユーザー(uid)の会社所属(companyId)を設定/解除する。companyId=null で解除。
export async function adminSetUserCompany(uid, companyId, adminUserId = null) {
  await waitForAuth();
  await updateDoc(doc(db, 'users', uid), {
    companyId: companyId,
    companyAssignedAt: new Date().toISOString(),
    companyAssignedBy: adminUserId
  });
  return true;
}
```

- [ ] **Step 4: 構文確認＋既存テスト**

Run: `cd ~/work/taxi-dev && node --check js/firebase-storage.js && node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 構文OK・全テスト pass（admin-assign-company の4件含む。fail 0）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add js/firebase-storage.js
git commit -m "feat(admin): listAllUsersWithStats returns companyId/lastActivityAt + adminSetUserCompany"
```

---

## Task 3: admin.html ユーザー表に会社列＋割り当てUI

**Files:**
- Modify: `admin.html`（import 追加、テーブルヘッダ、行セル、適用ハンドラ、会社一覧ロード）

- [ ] **Step 1: import を追加**

`admin.html` の import 群（363行: firebase-storage の import 行）に `adminSetUserCompany` を追加し、369行付近の後に admin-assign-company を import:

`from './js/firebase-storage.js?v=2'` の `{ ... }` 内に `, adminSetUserCompany` を追加。さらに新しい import 行を追加（既存 import 群の末尾、例: 369行の後）:

```js
import { buildAssignActions, formatAssignConfirm } from './js/admin-assign-company.js?v=1';
```

- [ ] **Step 2: テーブルヘッダに「会社」列を追加**

`admin.html` のユーザー表ヘッダ（「作成日」の `<th>` と「有効/無効」の `<th>` の間）に1列追加:

```js
      html += '<th style="text-align:left;padding:6px;border-bottom:1px solid #ddd;">会社 / 最終利用</th>';
```

挿入位置: `'<th ...>作成日</th>'` を出している行の直後、`'<th ...>有効/無効</th>'` の前。

- [ ] **Step 3: 各行に会社セル（現在値＋select＋適用）を追加**

行生成ループ内、`createdAt` のセル（`<td ...>${createdAt}</td>`）の直後に以下を追加（`companyOptions` は Step 4 で行ループ前に組み立てる文字列）:

```js
        const curCompany = u.companyId
          ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;">${u.companyId}</div>`
          : '<div style="font-size:10px;color:#999;">未所属</div>';
        const lastAct = u.lastActivityAt
          ? `<div style="font-size:9px;color:#999;">利用 ${new Date(u.lastActivityAt).toLocaleDateString('ja-JP')}</div>`
          : '';
        const selectHtml =
          `<select class="assign-company-sel" data-uid="${u.uid}" style="font-size:10px;max-width:120px;">`
          + `<option value="__none__"${!u.companyId ? ' selected' : ''}>（所属なし）</option>`
          + companyOptions(u.companyId)
          + `</select>`;
        html += `<td style="padding:6px;">${curCompany}${lastAct}`
          + `<div style="display:flex;gap:4px;margin-top:4px;">${selectHtml}`
          + `<button class="btn assign-company-btn" data-uid="${u.uid}" data-userid="${u.userId}" style="font-size:10px;padding:3px 8px;background:#1565c0;color:#fff;">適用</button></div></td>`;
```

- [ ] **Step 4: 会社一覧をロードして option 生成関数を用意**

`loadUsersBtn` ハンドラ内、`const users = await listAllUsersWithStats();` の直後に会社一覧を取得し、option 生成ヘルパを定義:

```js
    const companies = await adminListCompanies(); // [{id, freeForInvited?, ...}]
    const companyOptions = (selected) => companies.map(c =>
      `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${c.id}</option>`
    ).join('');
```

（`companyOptions` と `companies` は Step 3 の行ループ・Step 5 のハンドラから参照されるため、同じハンドラスコープ内に置く。）

- [ ] **Step 5: 「適用」ボタンのハンドラを追加**

`list.innerHTML = html;` の後、既存の `.btn-toggle-active` イベント登録ブロックの直後に追加:

```js
      // 会社割り当て（適用）
      list.querySelectorAll('.assign-company-btn').forEach(b => {
        b.onclick = async () => {
          const uid = b.dataset.uid;
          const userId = b.dataset.userid;
          const sel = list.querySelector(`.assign-company-sel[data-uid="${uid}"]`);
          const slug = sel ? sel.value : '__none__';
          const companyDoc = companies.find(c => c.id === slug) || null;
          const actions = buildAssignActions({ uid, userId }, slug, companyDoc);
          if (!confirm(formatAssignConfirm({ uid, userId }, actions))) return;
          try {
            await adminSetUserCompany(uid, actions.companyId, getMyUserId());
            if (actions.grantFree) {
              const existing = await adminGetSubscription(userId);
              const payload = adminBuildSubscriptionPayload(existing, { status: 'active', planId: 'comp_v1' });
              await adminSaveSubscription(userId, payload);
            }
            alert(actions.cleared
              ? `${userId} の所属を解除しました。`
              : `${userId} を ${actions.companyId} に所属させました。${actions.grantFree ? '（無償アクセスも付与）' : ''}`);
            document.getElementById('loadUsersBtn')?.click();
          } catch (err) {
            alert('会社割り当てに失敗しました: ' + (err.message || err)
              + '\n（companyId は設定済みでも無償付与だけ失敗した可能性があります。再読込で確認してください）');
          }
        };
      });
```

- [ ] **Step 6: 構文・スモーク確認**

Run: `cd ~/work/taxi-dev && node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 全テスト pass（admin.html はテスト対象外だが回帰がないこと）。
手動スモーク（Task 5 の dev 反映後、dev admin で）: ユーザー表に「会社/最終利用」列が出る → ある uid 行で会社を選び「適用」→ 確認ダイアログ → 再読込で companyId が反映 → 無償会社ならサブスク管理で active を確認。

- [ ] **Step 7: Commit**

```bash
cd ~/work/taxi-dev
git add admin.html
git commit -m "feat(admin): assign user to company from user table (select + apply)"
```

---

## Task 4: Service Worker（admin系jsをprecache＋bump）

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: STATIC_FILES に追加**

`sw.js` の STATIC_FILES、`'./js/admin-companies.js',` の直後に追加:

```js
  './js/admin-assign-company.js',
```

- [ ] **Step 2: CACHE_NAME を bump**

`sw.js:2` の `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` を、**現行 dev/main の版数を確認して +1**。

Run: `cd ~/work/taxi-dev && git fetch origin main >/dev/null 2>&1; git show origin/main:sw.js | grep -m1 CACHE_NAME`
→ 表示された版より大きい番号にする（並行セッションが頻繁に上げるため決め打ちしない）。

- [ ] **Step 3: 構文＋全テスト**

Run: `cd ~/work/taxi-dev && node --check sw.js && node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 構文OK・全テスト pass（fail 0）。`sw-precache-imports.test` も pass（admin.html の import は `?v=` 付きで対象外）。

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-dev
git add sw.js
git commit -m "chore(sw): precache admin-assign-company.js, bump cache"
```

---

## Task 5: dev 反映（ユーザー操作）

- [ ] **Step 1: dev へ push（Claudeは実行しない。ユーザーに提示）**

```
!~/work/taxi-dev/dpush.sh
```

- [ ] **Step 2: dev admin で動作確認**

dev admin（`/-taxi-daily-report-dev/admin.html`）でユーザーリストを読み込み → 会社列の表示 → 1ユーザーに会社割り当て → companyId反映 → 無償会社ならサブスク active 付与 を確認。

- [ ] **Step 3: あなたの user_self 解消＋本番**

dev でOKなら本番タグ（最新タグ確認の上 +1）で出荷。本番出荷後、admin で `userId==user_self` の該当 uid 行に `co-swyg3o` を割り当て、設定の招待セクション・退会の出し分けが出ることを確認。

---

## Self-Review

**Spec coverage:**
- 案A（既存テーブル拡張・uid単位） → Task 3 ✔
- 純関数 buildAssignActions/formatAssignConfirm → Task 1（+テスト）✔
- 書込 users/{uid}.companyId（+監査 assignedAt/By） → Task 2 adminSetUserCompany ✔
- 無償会社ならアクセス付与 → Task 3 ハンドラ（grantFree時に既存ヘルパ）✔
- 識別用 userId/現会社/最終利用日 表示 → Task 2（補完）＋Task 3（列）✔
- 確認ダイアログ・部分成功表示 → Task 3 ✔
- テスト → Task 1 ✔ / SWキャッシュ → Task 4 ✔ / デプロイ → Task 5 ✔
- YAGNI（履歴/一括/匿名マージなし） → 実装せず ✔

**Placeholder scan:** CACHE_NAME の版数のみ Task 4 で実行時確認（並行bump回避のため意図的）。コードのプレースホルダなし。

**Type consistency:** `userDoc`/行データの形 `{uid,userId,companyId?,lastActivityAt?}` は Task1テスト・Task2補完・Task3行で一致。`buildAssignActions(userDoc, slug, companyDoc) → {uid,userId,companyId,grantFree,cleared}`、`formatAssignConfirm(userDoc, actions)`、`adminSetUserCompany(uid, companyId, adminUserId)` のシグネチャは全タスクで一致。ハンドラは `companies`/`companyOptions` を同一スコープで参照（Task3 Step4で定義）。

**確度の低い点（実装中に検証）:** 既存 Firestore Rules で admin が他ユーザーの `users/{uid}.companyId` と `subscriptions/{userId}` を更新できるか（不可ならルール調整は別タスクとして要相談）。`updateDoc` の import 有無（Task2 Step2で確認）。

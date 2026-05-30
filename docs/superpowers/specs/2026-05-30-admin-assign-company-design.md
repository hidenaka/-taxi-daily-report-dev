# admin「ユーザーを会社に所属させる」機能 設計書

- **基準**: dev/main @ `f3a8dc551`、確認日 2026-05-30
- **ブランチ**: `feat/admin-assign-company`（dev clone `~/work/taxi-dev`、origin=dev）
- **目的**: 既存ユーザー（登録済み／匿名 user_self 等）を、admin画面から特定の会社に所属（companyId）させる。招待URL登録時にしか会社が付かない現状の欠落を埋める。

## 背景（なぜ必要か）

- 会社所属は `users/{uid}.companyId` に入る。これは **新規登録(signUp)時に招待slug(`taxi_pending_company`)から自動付与されるルートのみ**。
- 既に使っているユーザー（特に匿名 `user_self`：同一userIdに複数uidがぶら下がる）や、会社を移したいユーザーを **後から会社に紐づける手段が無い**。
- 影響: companyId が無いと、会社の歩率テーブル適用・設定の「会社招待URL」セクション表示・退会の出し分け等が動かない。
- データ実測(2026-05-30): 本番 `users` で `userId=='user_self'` が3件、全て companyId 無し。dev は3件中1件のみ `co-7q7ros`。

## スコープ

admin画面の既存「ユーザー管理テーブル」(uid行・有効/無効トグルあり)を拡張し、**uid単位**で会社を割り当て/変更/クリアできるようにする。割り当て時、その会社が無償(`freeForInvited:true`)なら恒久無料アクセスも同時付与する（招待登録と同じ状態を再現）。

**非対象(YAGNI)**: 移動履歴/監査ログ、一括割当、匿名uidの自動マージ、user→company の会社起点メンバー管理UI、既存データの別userIdへの移行。

## アーキテクチャ（採用案A: 既存テーブル拡張）

既存の admin ユーザー管理テーブルに「会社」列＋会社プルダウン＋「適用」ボタンを追加。判断ロジックは純関数モジュールに分離してテストする。

### コンポーネント

| ユニット | 役割 | 依存 |
|---|---|---|
| `js/admin-assign-company.js`（新規・純関数） | 書き込み計画を決める純関数群。DOM/Firestore非依存でテスト可能 | なし |
| `admin.html`（編集） | ユーザー表に会社列＋select＋適用ボタン。確認ダイアログ→Firestore書込→行リフレッシュ | admin-assign-company.js / 既存 firebase 関数 |
| `tests/admin-assign-company.test.js`（新規） | 純関数のテスト | run.js |

### `js/admin-assign-company.js` の純関数

```js
// 割り当て時の書き込み計画を返す。DOM/Firestore に触れない純関数。
// userDoc: 対象 users/{uid} の現在値（userId 等を含む）
// targetSlug: 割り当てる会社slug。'' / null はクリア（所属なし）。
// companyDoc: companies/{targetSlug} の値（無ければ null）
// 返り値: { companyId: string|null, grantFree: boolean, userId: string }
export function buildAssignActions(userDoc, targetSlug, companyDoc) { ... }

// 確認ダイアログ用の文言を組み立てる純関数。
export function formatAssignConfirm(userDoc, targetSlug, grantFree) { ... }
```

ルール:
- `companyId = targetSlug || null`
- `grantFree = Boolean(targetSlug) && companyDoc?.freeForInvited === true`
- `userId = userDoc.userId`（無償付与は userId 単位の subscriptions に書くため）

### UI（admin.html ユーザー表）

各 uid 行に表示・操作を追加:
- **表示列の追加**: `userId` / 現在の `companyId`（無ければ「—」）/ 最終利用日 `lastActivityAt`（user_self の複数uidを見分けるため）
- **操作**: 会社 `<select>`（先頭「（所属なし）」＋既存の会社リスト slug 群）＋「適用」ボタン

「適用」ハンドラ:
1. 選択 slug を取得。`buildAssignActions` で計画を作る。
2. `confirm(formatAssignConfirm(...))` で確認。キャンセルなら中断。
3. `updateDoc(doc(db,'users',uid), { companyId, companyAssignedAt: <ISO>, companyAssignedBy: <admin userId> })`（merge更新）。
4. `grantFree` の時のみ、既存ヘルパを再利用して無償付与:
   `adminGetSubscription(userId)` → `adminBuildSubscriptionPayload(existing, { status:'active', planId:'comp_v1' })` → `adminSaveSubscription(userId, payload)`。
5. 行をリフレッシュして結果表示（成功/部分成功/失敗）。

### データフロー

会社リスト読込（既存の会社管理ロジックを流用）→ 各 uid 行に slug の select 生成 → admin が選択→適用 → 確認 → `users/{uid}.companyId` 書込（＋無償会社なら `subscriptions/{userId}` 付与）→ 行リフレッシュ。

### Firestore 書き込み先

- `users/{uid}`: `companyId`（＋ `companyAssignedAt` / `companyAssignedBy` の監査用最小フィールド）。merge更新。
- `subscriptions/{userId}`: 無償会社のときのみ、既存の付与ペイロード。
- 認可は既存の admin Firestore Rules に従う（admin のみ書込可）。新ルールは追加しない前提（既存で users/subscriptions への admin 書込が通る想定。通らなければ実装中に確認）。

## エラー処理

- select が「（所属なし）」かつ現状も無し → 何もしない（no-op）。
- 対象 slug が会社リストに無い → エラー表示（select 由来なので通常起きない）。
- ステップ3成功・ステップ4失敗 → 「所属は設定しました／無償付与に失敗しました」と部分結果を明示（companyId は残す）。
- すべて try/catch、結果テキストは既存 admin パターン（`✓`/`✗`）に揃える。

## テスト

`tests/admin-assign-company.test.js`（`node --test`, run.js）:
- `buildAssignActions`:
  - slug 指定＋ `freeForInvited:true` → `{ companyId:slug, grantFree:true, userId }`
  - slug 指定＋ `freeForInvited` 無し/ companyDoc=null → `grantFree:false`
  - `targetSlug=''`/`null`（クリア）→ `{ companyId:null, grantFree:false }`
  - `userId` が userDoc から正しく伝播
- `formatAssignConfirm`: slug/クリア/無償有無で文言が変わる（含意の検証）。
- UI 配線は admin の課金ゲート/管理者ゲート下のため、スモークは手動（dev admin画面で1ユーザーを割当→companyId反映→無償会社なら access 付与を確認）。

## アクセス制御・オフライン・デプロイ

- admin画面は管理者限定（既存ゲート）。今回ゲートは変更しない。
- `admin.html` が SW precache 対象なら新規 `js/admin-assign-company.js` を STATIC_FILES に追加し `CACHE_NAME` を bump（実装時に sw.js を確認）。admin が PWA キャッシュ対象でなければ不要。
- dev反映 = `!~/work/taxi-dev/dpush.sh`。本番 = 次タグ（v1.47.0 目安、最新タグ確認の上）。

## 確度の低い点（実装中に検証）

- 既存 Firestore Rules で admin が他ユーザーの `users/{uid}.companyId` と `subscriptions/{userId}` を更新できるか（できなければルール調整が別途必要＝その場合はスコープ拡大として相談）。
- ユーザー表の現行カラム構成（userId/lastActivityAt が既に取れているか）。取れていなければ取得を足す。
- 無償付与ヘルパ（`adminGetSubscription`/`adminBuildSubscriptionPayload`/`adminSaveSubscription`）の正確なエクスポート元。

## あなたの user_self 解消（出荷後の使い方）

本機能出荷後、admin のユーザー表で `userId==user_self` の該当 uid 行（最終利用日で自分のセッションを特定）を選び、本番 `co-swyg3o` を割り当てる。これで招待セクション表示・退会の出し分けが動く。

# マルチカンパニー段階2 ＋ 統合分析オプトアウト（C案）＋ 営業地Phase2 統合計画

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans でタスク順に実装。

**Goal:** マルチカンパニー段階2（会社別申込リンク等）と、営業サポートの「全員データ統合」参加方式（C案＝提供と閲覧を連動）の実装、および営業地検索の会社別デフォルトを一括導入する。

**Architecture:**
- 会社別申込リンク `?company=<slug>` を任意ページで捕捉、登録時に `users/{uid}.companyId` 確定（段階2）
- `users/{uid}.participatesInAggregateAnalysis: boolean` で営業サポート統合分析の参加ON/OFF（C案）
- `companies/{companyId}.defaultRecArea: string` で営業地検索の会社別デフォルト（営業地Phase2）

**Tech Stack:** バニラJS（ESモジュール）、Firebase Firestore、Cloudflare Worker（既存課金）、`node --test`

**設計書/関連メモ:**
- マルチカンパニー全体: `docs/superpowers/specs/2026-05-18-multi-company-profiles-design.md`
- C案決定: `.company/secretary/notes/2026-05-20-decisions.md` 第1項
- C案詳細: `.company/secretary/notes/2026-05-20-shared-sales-data-policy.md`
- 営業地Phase2: `.company/engineering/debug-log/2026-05-20-support-default-area.md` Phase 2
- 広報物文言: `.company/secretary/notes/2026-05-20-pr-privacy-copy-fix.md`

**段階1（完了済み）**: `dev/main c29b303`、`02d0619`、`a81e3c4`。`companies/{companyId}` データモデル、`getConfig` 会社マージ、admin 会社管理UI、給与モード別フィールド、既存 user_self/mm に `companyId=keiho` 付与済み。

---

## スコープ

### 段階2: 会社別申込リンク
- 申込URLに `?company=<slug>` クエリで会社固定
- `subscribe.html`／`login.html`／`index.html` のいずれで捕捉しても localStorage `taxi_pending_company` に保持（既に `firebase-auth.js:createUserWithCredentials` は対応済み）
- 登録時に `companyId` が確定する（実装済み）

→ 段階2のメインは **「実際に URL を組合に配布できる」** ところまで。具体的には:
- 申込フローで `?company=keiho` などのリンクが正しく動くことの動作検証
- 会社固有のチラシ／LP用 QR コードを別途準備（広報部署で）
- admin UI に「申込リンクをコピー」ボタン追加

### C案: 統合分析の参加ON/OFF
- `users/{uid}.participatesInAggregateAnalysis: boolean`（default: true）
- 設定画面に「営業サポートのベンチマーク統合分析に参加する」トグル追加
  - OFF確認ダイアログ「営業サポートで他のドライバーのエリア統計が見られなくなります。良いですか？」
- `getAllUsersDrivesForMonth` 等で `where('participatesInAggregateAnalysis', '==', true)` でフィルタ
- `support.html` の「(全員データ統合)」3カードは、自分が OFF なら「設定でONにすると利用できます」プレースホルダ
- `legal/privacy.html` に「設定で統合分析への提供をOFFにでき、その場合は全員データを参照する機能も無効になります」追記
- 既存2ユーザー（user_self/mm）は true で移行（マイグレーションスクリプト）
- 広報物4ファイルの「設定で集計への参加は変更できる予定です」を「設定で参加ON/OFF可能」に更新

### 営業地Phase2: 会社別デフォルト
- `companies/{companyId}.defaultRecArea: string`（例: `keiho` なら `'千代田区丸の内'`）
- admin 会社管理UI「🏢 会社管理」に「営業地デフォルト」入力欄追加
- `js/company-config.js` の `COMPANY_LEVEL_KEYS` に `defaultRecArea` 追加
- `support.html populateRecommendArea` の `companyDefault` 引数を会社プロファイルから取得して渡す（Phase 1 で hook ポイントは作成済み）

---

## 実装タスク

### Task 1: `users/{uid}.participatesInAggregateAnalysis` フィールド追加

**Files:**
- `firestore.rules` — 既存の users ルールに participatesInAggregateAnalysis の書込権限（本人のみ）を確認
- `js/firebase-auth.js` `createUserWithCredentials` — 新規登録時に true を初期値で書込
- `scripts/migrate-aggregate-analysis-default-true.mjs`(新) — 既存ユーザーで未定義のものを true で埋める一回限りスクリプト

**テスト:**
- `firestore.rules` の users 書込テスト（本人OK・admin OK・他人NG）
- `firebase-auth.test.js`(新規 or 拡張) で createUserWithCredentials が `participatesInAggregateAnalysis: true` を含む doc を作る

### Task 2: `getAllUsersDrivesForMonth` のフィルタ追加

**Files:**
- `js/firebase-storage.js` `getAllUsersDrivesForMonth` — `listActiveUserIds` の代わりに `participatesInAggregateAnalysis == true` のユーザーリストを取得
- `js/firebase-storage.js` `listActiveUserIds` を拡張、または新規 `listAggregateAnalysisUserIds` を追加（用途分離）

**テスト:**
- 「自分が OFF / 他人が ON」のシナリオで自分のデータが入らないこと
- 「自分が ON / 他人が OFF」のシナリオで他人のデータが入らないこと

### Task 3: 設定画面トグルUI

**Files:**
- `settings.html` — 「営業サポートのベンチマーク統合分析に参加する」トグル追加（位置: プライバシー関連の項目）
- OFF時の確認ダイアログ実装
- `js/storage.js` `getConfig`/`saveConfig` で `participatesInAggregateAnalysis` を扱う or `users/{uid}` 直接更新する経路

**テスト:**
- 「トグルOFF→ダイアログ→OK→Firestore 更新」フロー（手動 or jsdom 系 e2e）

### Task 4: `support.html` のプレースホルダ

**Files:**
- `support.html` — `enforceAccess` 取得直後に `participatesInAggregateAnalysis` を読み、false なら3カード（recommendCard/highValueCard/areaCard）を「設定でONにすると利用できます」プレースホルダに差し替え

**テスト:**
- support.html を読込時の表示分岐（手動 or e2e）

### Task 5: `legal/privacy.html` 追記

**Files:**
- `legal/privacy.html` — 第3条 利用目的 の「営業サポート機能における匿名化されたベンチマーク統合分析」のあとに「※利用者は設定により本集計への参加をOFFにできます。OFF時は全員データを参照する機能も同時に無効化されます」を追記

### Task 6: 既存ユーザー2名のマイグレーション

**Files:**
- `scripts/migrate-aggregate-analysis-default-true.mjs`(新) — `users` コレクションを走査、`participatesInAggregateAnalysis` が未定義の doc に true をセット
- 実行記録を `.company/finance/notes/` か `.company/secretary/notes/` に残す

### Task 7: `companies/{companyId}.defaultRecArea` 追加（営業地Phase2）

**Files:**
- `firestore.rules` — companies ルールに defaultRecArea の書込権限（admin のみ）を確認（companies の既存ルールがそのまま使える想定）
- `js/company-config.js` — `COMPANY_LEVEL_KEYS` に `defaultRecArea` 追加
- `js/admin-companies.js` — `buildCompanyDoc` の検証ロジックに `defaultRecArea`（文字列・任意）を追加
- `admin.html` — 「🏢 会社管理」フォームに「営業地デフォルト」入力欄追加
- `scripts/seed-keiho-company.mjs` — 恵豊プロファイルに `defaultRecArea: '千代田区丸の内'` を追加（実行は不要・seed は記録だけ）

**テスト:**
- `admin-companies.test.js`(拡張) で `defaultRecArea` 検証ロジックのテスト
- ※既存純関数 `chooseInitialRecArea` には変更不要（Phase 1で `companyDefault` 引数を既に受ける形にしてある）

### Task 8: `support.html populateRecommendArea` で companyDefault を会社プロファイルから取得

**Files:**
- `support.html` — `populateRecommendArea` 内で `getConfig()` から `defaultRecArea` を取り、`chooseInitialRecArea` の `companyDefault` 引数に渡す

**テスト:**
- 既存テスト維持（Phase 1で書いた rec-area.test.js は変更不要）

### Task 9: 段階2の申込リンクUI（admin UI 強化）

**Files:**
- `admin.html` — 「🏢 会社管理」フォームに「申込URL」表示＋「コピー」ボタン追加（slug から `https://app.taxicabis.com/?company=<slug>` を生成）

**テスト:**
- URL生成の純関数テスト

### Task 10: 広報物4ファイルの最終文言更新

**Files:**
- `.company/pr/materials/index.html` — 「設定で集計への参加は変更できる予定です」→「設定で参加ON/OFF可能」
- `.company/pr/materials/cabis-flyer-a4-2page.html` — 同上
- `.company/pr/materials/cabis-flyer-a4-2page-keiho.html` — 同上
- `.company/pr/materials/cabis-flyer-a4.html` — 既存テキストに「（設定で参加ON/OFF可能）」を追記

→ C案実装が dev完了したタイミングで文言を確定形に変更（実装着手より前に文言だけ修正する場合は「予定です」のままにする）。

### Task 11: dev反映 → 本人検証 → 本番反映

- dev/main へ Task 1-9 を順次反映、各Taskごとに本人検証可能な状態を保つ
- 全部dev確認後、まとめて origin/main へ cherry-pick（複数コミットになる想定）
- 本番反映後に Task 10（広報物の文言確定）を反映

### Task 12: 完全招待制 signup ガード（decisions 6 で追加・2026-05-20）

**背景:**
本人指摘「サービス提供時、まずユーザーがどこの会社の誰かを特定しないと開発・運用ができない」。
3パターン（自社/他社カスタマイズ済/新規飛び込み）の対応分けを `decisions.md` の「6. 会社識別の3パターン対応設計」で確定。**完全招待制**を採用。

**目的:**
- 招待URL `?company=<slug>` 経由 = signup 可（`users/{uid}.companyId = <slug>` 確定）
- 招待URLなしで `login.html?mode=signup` 直叩き = エラー表示 + mailto誘導
- 不正/未登録 slug = エラー表示 + mailto誘導

**Files:**
- `js/invite-url.js`(新) — 純関数 `captureInviteSlug(url, storage)` + `loadInviteSlug(storage)` + `validateInviteSlug(slug, companies)` をテスト可能に切り出す
- `subscribe.html` — ページ読込時に `captureInviteSlug` 呼出（URLに `?company=` あれば localStorage に保存）
- `login.html` — ページ読込時に `captureInviteSlug` 呼出 + signup タブ表示時に `loadInviteSlug` で招待状況確認 → 空ならフォーム非表示にして「招待URLが必要です」エラー＋ mailto誘導UI、 不正 slug でも同様
- `index.html` — ページ読込時に `captureInviteSlug` 呼出（トップに `?company=` で着地したケースの捕捉）
- `js/firebase-auth.js` — `signUp` 関数の冒頭で `loadInviteSlug` + `validateInviteSlug` チェック、空/不正なら `{ success: false, error: 'invite-required' }` を返す（呼出側でUI制御）
- `tests/invite-url.test.js`(新) — `captureInviteSlug` / `loadInviteSlug` / `validateInviteSlug` の3関数を全パターン（URLあり/なし/不正、localStorage clear時挙動、companies 配列マッチング）でテスト

**動作仕様（招待URLなし signup の挙動）:**
1. ユーザーが直接 `https://...dev/login.html?mode=signup` を踏む
2. ページ読込で localStorage.taxi_pending_company を確認 → 空
3. signup フォーム部分を非表示にし、その位置に警告ボックスを表示:
   ```
   ⚠️ 新規登録には招待URLが必要です
   会社/組合からお渡しした招待URL経由でアクセスしてください。
   招待URLをお持ちでない場合は、お問い合わせください: cabis@taxicabis.com
   ```
4. 「ログイン」タブはそのまま機能させる（既存ユーザーは弾かない）

**動作仕様（不正/未登録 slug の場合）:**
1. ユーザーが `?company=invalid` で着地
2. captureInviteSlug は値を localStorage に保存
3. signup タブ表示時に validateInviteSlug が `companies/{slug}` を Firestore 取得 → 存在しなければ削除＋エラー表示
4. 「招待URLが無効です。担当者にURLをご確認ください」+ mailto

**動作仕様（招待URLあり・正常 slug）:**
1. captureInviteSlug が localStorage に保存
2. signup フォーム表示
3. `createUserWithCredentials` が `taxi_pending_company` を読んで companyId 確定（既存実装）

**テスト:**
- `captureInviteSlug` 純関数テスト: URL に `?company=keiho` あり → storage に保存 / URL に無し → storage 触らない / 既存値あり→上書き
- `loadInviteSlug` 純関数テスト: storage から取得 / 空なら null
- `validateInviteSlug` 純関数テスト: companies に slug あり → true / 無し → false / null → false

**既存ユーザーへの影響:**
- 既存 user_self/mm は `companyId=keiho` 付与済み → 影響なし
- 新仕様は新規 signup のみに適用、login（既存ユーザーのログイン）は影響なし

**並行進行・依存:**
- Task 9 (申込URLコピー = `?company=<slug>` 配布URL生成) の **対** になる仕組み → Task 9 完了後に Task 12 で受け側を実装する自然な順序
- Task 1-11 とファイル衝突なし（`js/firebase-auth.js` の `signUp` 関数のみ追加修正、`createUserWithCredentials` は触らない）

---

## 依存・順序

```
Task 1 (フィールド追加・初期化)
  └─ Task 2 (フィルタ)
       └─ Task 3 (UI トグル)
            └─ Task 4 (プレースホルダ)
Task 5 (privacy.html) — Task 1 と並行可
Task 6 (既存マイグレ) — Task 1 直後
Task 7 (defaultRecArea フィールド)
  └─ Task 8 (populateRecommendArea 配線)
Task 9 (申込URL UI) — 独立
  └─ Task 12 (signupガード) — Task 9 完了後（招待URL受け側）
Task 10 (広報物確定文言) — Task 3 dev完了後
Task 11 (本番反映) — 全部dev完了後
```

並行進行が可能なタスク群: {Task 1, Task 5, Task 7, Task 9} は互いに独立。Task 12 は Task 9 完了後。

---

## リスクと注意

### Firestore Rules 変更
- Task 1 の users 書込ルールは既存と互換である必要（participatesInAggregateAnalysis の追加で本人以外が書けるようになる事故を避ける）
- Task 7 の companies は admin 限定 write 既存ルールを継承（追加変更不要見込み）
- ルール変更は `firebase deploy --only firestore:rules` で dev→prod 各環境に必要

### マイグレーション（Task 6）
- 既存 user_self/mm は Auth uid 5件（segment 1 + segment 2 以上）。Task 6 で全 uid 走査
- 実行ログを残し、後でロールバック可能にする（false に戻すには再実行）

### 計算結果への影響
- C案OFF設定のユーザーは「自分の営業サポート機能を失う」。これは設計通りだが、UX上「OFFにしたら何も見えなくなる」のは丁寧な確認ダイアログが必須
- 統合分析対象ユーザーが減ると、母集団のサンプルが少なくなり統計の信頼性が下がる→「OFF にする人が多すぎる場合の対応」は別途運用判断

### 段階2の申込リンク（Task 9）
- 既に `firebase-auth.js:createUserWithCredentials` は `taxi_pending_company` を読む実装済み
- admin UI のリンクコピーボタンを追加するだけで段階2 は本格運用可能になる

### 広報物（Task 10）
- C案実装が dev に乗ったタイミングで文言を「予定です」→「ON/OFF可能」に確定
- LP公開前に Task 10 を完了させると、公開時から正確な文言になる

---

## 検証

各Task完了時の検証ポイント:

| Task | 検証 |
|---|---|
| 1 | 新規登録時の users doc に `participatesInAggregateAnalysis: true` が入る |
| 2 | OFFユーザーのデータが集計に入らない／OFFユーザーが他人データを取得しない |
| 3 | 設定UIでトグル切替できる、確認ダイアログが出る |
| 4 | 自分がOFFの時、support.html の3カードがプレースホルダになる |
| 5 | privacy.html に追記反映 |
| 6 | 既存2ユーザーが `participatesInAggregateAnalysis: true` を持つ |
| 7 | admin 会社管理UIで `defaultRecArea` を保存できる |
| 8 | `companies/keiho.defaultRecArea` が設定された時、support.html の初期エリアに反映 |
| 9 | admin UIで申込URLが表示・コピーできる |
| 10 | LP・チラシ4ファイルの文言が確定形に |
| 11 | 本番反映後、本人と既存ユーザー2名で動作確認 |

---

## 工数見積（参考）

- Task 1: 0.5日（フィールド追加・テスト・dev反映）
- Task 2: 0.5日
- Task 3: 1日（UI・確認ダイアログ・テスト）
- Task 4: 0.5日
- Task 5: 0.2日
- Task 6: 0.3日
- Task 7: 0.5日
- Task 8: 0.3日
- Task 9: 0.5日
- Task 10: 0.2日
- Task 11: 0.5日（複数コミットの cherry-pick + 本人検証）

**合計: 約5.5日相当**（実装着手から本番反映まで）

---

## 残された判断ポイント

- 段階2の admin UI 「申込URLコピー」は今やるか、組合配布タイミングで別途やるか
- 新規ユーザー登録時の `participatesInAggregateAnalysis` 初期値は **true で良いか**（C案決定時の判断保留事項）
- 営業地Phase2 の `defaultRecArea` は admin が必ず設定するか、未設定なら「千代田区丸の内」フォールバックで運用するか（後者なら admin UI 任意項目）

これらは実装着手時にユーザー判断を仰ぐ。

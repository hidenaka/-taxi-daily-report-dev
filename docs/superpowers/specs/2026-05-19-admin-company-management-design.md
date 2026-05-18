# admin 会社管理UI（マルチカンパニー段階3）設計

作成: 2026-05-19 ／ 状態: ドラフト（ユーザーレビュー待ち）

## 概要

マルチカンパニー段階1（データモデル＋恵豊パッケージ化）完了後、会社プロファイル
`companies/{companyId}` を編集する手段が seed スクリプトと Firebase Console のみで、
アプリの管理画面からは扱えない。本段階で `admin.html` に「会社管理」セクションを
追加し、中野氏が会社プロファイルの作成・編集を管理画面で完結できるようにする。

親設計: `docs/superpowers/specs/2026-05-18-multi-company-profiles-design.md`（段階3）

## 背景・経緯

- 段階1で `companies/keiho` を作成。会社レベル設定（歩率テーブル・手取り率等）は
  `getConfig()` が会社プロファイル優先でマージするようになった。
- その結果、admin.html の既存「ユーザー設定編集」で恵豊ユーザーの会社レベル項目を
  編集しても、アプリ側では会社プロファイルに上書きされ無効になる。
- 恵豊の歩率等を今後変更する運用を想定し、会社プロファイルの正しい編集口を
  管理画面に用意する（2026-05-19 ユーザー判断）。

## スコープ

含む:
- 既存会社プロファイルの読み込み・編集・保存
- 新規会社プロファイルの作成

含まない（後続段階）:
- 申込リンク（`?company=<slug>`）の捕捉・登録時 companyId 付与（段階2）
- subscribe の会社別価格自動適用（段階4）
- 通常プランの自己設定UI（段階5）
- 日報書式の会社別対応／OCR（段階6）
- 休憩時間・会社負担の高速代・車両種類リスト（新規項目・段階4以降）

## 設計・方針

### 採用アプローチ

`admin.html` に専用セクション「🏢 会社管理」を1枚追加する。既存「⚙️ ユーザー設定
編集」セクションと同型のパターンで実装し、認証ガードは admin.html のものに乗る。
CRUD ロジックは admin.html の肥大化を避けるため `js/admin-companies.js`（ESモジュール）
に切り出し、admin.html の `<script type="module">` から import する。

却下案:
- 別ページ `admin-companies.html`: ページ追加・認証ガード再実装・sw.js 登録が必要。
  現状1セクションで足りる規模のためオーバー。段階4-5でUIが増えたら再検討。
- 既存 `companyTemplates` コレクションの流用: 用途が異なる（ユーザー作成時の
  歩率テンプレ）。`companies` と混ぜると段階1の参照モデルが壊れる。

### データモデル

`companies/{companyId}` ドキュメント（companyId == slug）:

| フィールド | 型 | 内容 |
|---|---|---|
| `name` | string | 会社名（表示用） |
| `slug` | string | 申込リンク用識別子。documentId と同値 |
| `plan` | 'partner' \| 'normal' | 提携／通常 |
| `active` | boolean | 有効フラグ |
| `rateTable` | object | 歩率テーブル（乗務数 4〜11 ＋ `12_13rate`） |
| `takeHomeRate` | number | 手取り率 |
| `responsibilityShifts` | number | 責任出番数 |
| `premiumIncentive` | object | `{ thresholdSalesExclTax: number, amountPerShift: number }` |
| `paidLeaveAmount` | number | 有給休暇1日あたり金額 |
| `payrollMode` | string | 給与モード（`step_rate` 等） |
| `fixedRate` | number | 固定率 |
| `updatedAt` | string | ISO 日時。保存時に付与 |

会社レベル7項目（`rateTable`〜`fixedRate`）は `js/company-config.js` の
`COMPANY_LEVEL_KEYS` と一致する。編集フォームはこの定数を import して駆動し、
段階1との整合を保つ。

`firestore.rules` は段階1で `companies/{companyId}` の `write: if isAdmin()` を
デプロイ済みのため、本段階でのルール変更は不要。

### コンポーネント

**`js/admin-companies.js`（新規 ESモジュール）**

責務: 会社プロファイルの CRUD と、フォーム値⇄ドキュメントの変換。

- `buildCompanyDoc(formValues)` — 純関数。フォーム値オブジェクトを受け取り、
  保存用の `companies` ドキュメントオブジェクトを返す。必須項目チェック・型変換
  （number 化）・`premiumIncentive` のネスト構築・`slug` 形式検証を行う。
  検証エラー時は `{ error: '...' }` を返す。テスト対象。
- `loadCompanyList()` — `getDocs(collection(db,'companies'))` で全件取得。
- `loadCompany(companyId)` — 単一ドキュメント取得。
- `saveCompany(companyId, docData, isNew)` — `setDoc` で保存。`isNew` 時は
  既存ID衝突を事前チェック。
- フォーム描画・読み戻しの DOM 操作関数（テスト対象外）。

**`admin.html` — 新セクション「🏢 会社管理」**

「⚙️ ユーザー設定編集」セクションの前に配置:

- 会社選択 `<select id="companySelect">`: 先頭に「＋ 新規会社を作成」、以降に
  読み込んだ会社を列挙。
- 「会社リストを読み込み」ボタン。
- フォーム:
  - 会社ID（slug）— `<input>`。新規時のみ編集可、既存選択時は readonly。
  - 会社名 `name` — `<input>`。
  - プラン `plan` — `<select>`（提携 partner / 通常 normal）。
  - 有効 `active` — `<input type="checkbox">`。
  - 給与モード `payrollMode` — `<select>`。
  - 固定率 `fixedRate`／手取り率 `takeHomeRate`／責任出番数 `responsibilityShifts`／
    有給1日金額 `paidLeaveAmount`／インセンティブ閾値売上／インセンティブ額（出番あたり）
    — すべて `<input type="number">`。
  - 歩率テーブル `rateTable` — 既存 `renderAdminRateTable` を再利用し
    `#companyRateTableEditor` に描画。
- 「💾 会社を保存」ボタン。
- ステータス表示 `<div>`。

**`renderAdminRateTable` の小改修**

既存 `renderAdminRateTable` はコンテナ `#adminRateTableEditor` を固定参照している
想定。会社管理でも使えるよう、コンテナ要素（または要素ID）を引数で受け取れるよう
パラメータ化する。既存呼び出し（ユーザー設定編集）は引数に `adminRateTableEditor`
を渡す形に置き換え、挙動は不変。歩率テーブルの読み戻し（保存時に input 群を走査
してオブジェクト化する処理）も同様にコンテナ指定で動くようにする。

### データフロー

1. **会社リスト読み込み**: ボタン押下 → `loadCompanyList()` → `companySelect` に
   `<option>` を生成（value=companyId、表示=`name`）。
2. **会社選択**:
   - 「＋ 新規会社を作成」→ `DEFAULT_CONFIG` ベースのひな型でフォームを充填
     （歩率テーブルの段組み構造が入る）。slug は空・編集可。`plan`/`active` は
     既定（partner / true）。
   - 既存会社 → `loadCompany(id)` → フォーム充填。slug は readonly。
3. **保存**: 「会社を保存」押下 → フォーム値を集約 → `buildCompanyDoc(formValues)`
   で検証＋ドキュメント化 → エラーなら赤字表示・中断 → `saveCompany()` で
   `setDoc(doc(db,'companies',slug), {...doc, updatedAt})`。新規時は既存IDと
   衝突したら保存前に警告。成功でステータス更新・会社リスト再読み込み。

### 関連改善（整合性）

段階1で会社レベル項目はマージ時に会社優先になったため、admin の「ユーザー設定編集」
で会社所属ユーザーの会社レベル項目を編集してもアプリ側では無効になる。

→ 本段階で「⚙️ ユーザー設定編集」セクションに注意書きを1行表示する:
「※歩率・手取り率など会社レベル項目は『会社管理』で設定します。会社に所属する
ユーザーには会社プロファイルが優先されます。」

項目自体の削除はしない。`companyId` を持たない通常プランユーザーには
ユーザー設定編集の会社レベル項目が引き続き有効なため（段階5で扱う）。

### エラーハンドリング

- 会社リスト読み込み失敗・保存失敗（権限／ネットワーク）→ ステータスに赤字表示。
  フォームの入力値は保持する。
- 新規会社の slug が既存会社IDと衝突 → 保存前に警告し中断。
- slug 形式検証: 半角英小文字で始まり、英小文字・数字・`_` のみ（`signUp` の
  userId と同じ規則）。不正なら `buildCompanyDoc` がエラーを返す。
- 必須項目（`name`、`slug`、会社レベル7項目）の欠落・非数値 → `buildCompanyDoc`
  がエラーを返す。

### テスト

- `buildCompanyDoc(formValues)` を `js/admin-companies.js` から export し
  `tests/admin-companies.test.js` で node:test:
  - 正常系: 全フィールドが揃ったフォーム値 → 正しい型のドキュメント
    （number 化、`premiumIncentive` のネスト構築、`COMPANY_LEVEL_KEYS` を網羅）。
  - slug 検証: 不正な slug（大文字・記号・数字始まり）でエラー。
  - 必須欠落: `name` 欠落・会社レベル項目の非数値でエラー。
- DOM 操作・Firestore I/O はテスト対象外（既存方針と同じ）。
- 全テスト回帰（段階1の 241 件＋新規分）。

## 残論点

- `payrollMode` の選択肢の網羅: 現状 `step_rate` のほか取り得る値を実装時に
  `js/default-config.js` ／ `js/payroll.js` から確認して select に反映する。
- 新規会社のひな型を `DEFAULT_CONFIG`（恵豊相当）ベースにするため、作成直後に
  値を直さないと恵豊と同じ歩率になる。実装時、新規作成フォームの歩率テーブルに
  「ひな型値。会社の実値に直すこと」の注意書きを添えるか検討。

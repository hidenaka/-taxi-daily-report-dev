# 会社管理UI 給与モード別フィールド対応 設計

作成: 2026-05-19 ／ 状態: ドラフト（ユーザーレビュー待ち）

## 概要

マルチカンパニー段階3で `admin.html` に会社管理UIを追加したが、給与モード
（`payrollMode`）に関わらず歩率テーブル（部立テーブル）の入力が必須・常時表示に
なっている。固定部立の会社は乗務数別の歩率表を持たず、固定率（`fixedRate`）だけで
給与が決まるため、歩率テーブルは無意味なノイズになる。

会社管理UIを給与モードに応じて入力項目を出し分け、`buildCompanyDoc` の検証を
モード別にする。

親設計: `docs/superpowers/specs/2026-05-19-admin-company-management-design.md`（段階3）

## 背景・経緯

- 段階3 dev 反映後、ユーザーが実機確認し「OKだが部立テーブルがない会社もある」と
  指摘（2026-05-19）。
- タクシー会社の給与体系は「変動部立（乗務数別の段階歩率）」「固定部立（売上×固定
  歩率）」「月給制（売上非依存）」の3種。
- `payroll.js` の `calcBasePay` は2モードを実装済み: `payrollMode==='fixed_rate'`
  は `fixedRate` のみ使い `rateTable` を一切参照しない／それ以外（段階歩率）は
  `rateTable` を使う。
- 月給制は `payroll.js` に存在せず、新モード追加＋ホーム画面（売上→歩率→着地
  見込み→手取り）の対応を要するため**別サブプロジェクト**として後日設計する
  （2026-05-19 ユーザー判断）。本設計のスコープは変動部立＋固定部立のみ。

## スコープ

含む:
- 会社管理UIの給与モードラベルを「変動部立／固定部立」に変更
- 給与モードに応じた入力項目の表示切替（歩率テーブル／固定率）
- `buildCompanyDoc` のモード別検証

含まない:
- 月給制（別サブプロジェクト）
- `payroll.js` の計算ロジック変更（既存2モードで足りる）
- ホーム画面・段階1コード・段階3の他部分

## 設計・方針

### 採用アプローチ

`payrollMode` セレクトの `onchange` でUI項目を出し分ける（案1）。却下案: 全項目
常時表示（固定部立の会社に無意味な歩率テーブルが残り、指摘に応えない）／モード別
の別フォーム（オーバー）。

`payroll.js` の計算は変更しない。`fixed_rate` 分岐は `rateTable` を参照せず、
段階歩率分岐は `fixedRate` を参照しないため、会社プロファイルから不要キーを省いても
計算に影響しない。段階1の `mergeCompanyConfig` は「会社プロファイルに無いキーは
個人設定の値を維持」する仕様のため、省略しても既存挙動を壊さない。

### コンポーネント

**`admin.html` — 会社管理セクション**

1. **給与モードラベル変更**: `<select id="companyPayrollMode">` の option 表示
   テキストを変更。内部 value は不変。
   - `step_rate`: 「段階歩率（step_rate）」→「変動部立」
   - `fixed_rate`: 「固定率（fixed_rate）」→「固定部立」

2. **項目ラッパ**: 固定率入力（`#companyFixedRate` とそのラベル）を
   `<div id="companyFixedRateField">` で囲む。歩率テーブル一式（見出し「歩率
   テーブル」・説明文・`#companyRateTableEditor`・前後の `<hr>`）を
   `<div id="companyRateTableField">` で囲む。

3. **表示切替関数** `applyCompanyPayrollModeUI()`:
   - `#companyPayrollMode` の現在値を読む。
   - `fixed_rate` → `companyFixedRateField` を表示、`companyRateTableField` を
     `display:none`。
   - それ以外（`step_rate`）→ `companyRateTableField` を表示、
     `companyFixedRateField` を `display:none`。

4. **呼び出し箇所**:
   - `#companyPayrollMode` の `onchange` ハンドラ。
   - `fillCompanyForm` の末尾（会社読み込み・新規作成時の初期表示を正す）。

**`js/admin-companies.js` — `buildCompanyDoc`**

検証をモード別に分岐する:

- 共通必須（モードに依らず）: `slug`、`name`、`plan`、`payrollMode`、
  `takeHomeRate`、`responsibilityShifts`、`paidLeaveAmount`、
  `premiumIncentive.thresholdSalesExclTax`、`premiumIncentive.amountPerShift`。
- `payrollMode === 'fixed_rate'`: `fixedRate` が有限数であること。
  doc に `fixedRate` を含め、`rateTable` は含めない。
- `payrollMode !== 'fixed_rate'`（= `step_rate`）: `rateTable` がオブジェクト
  であること。doc に `rateTable` を含め、`fixedRate` は含めない。
- `payrollMode` は空でないこと。想定値は `step_rate` / `fixed_rate`。

`buildCompanyDoc` への入力 `form` は従来通り `rateTable` と `fixedRate` の両方を
受け取る。モード判定により doc に入れる側を選び、不要な側は捨てる。

### データフロー

1. **会社読み込み**（既存会社選択）: `fillCompanyForm(c, false)` が各フィールドを
   埋め、`#companyPayrollMode` に `c.payrollMode` をセット →
   `applyCompanyPayrollModeUI()` で表示を体系に合わせる。固定部立の会社は
   `rateTable` を持たないが、`fillCompanyForm` の既存フォールバック
   `c.rateTable || DEFAULT_CONFIG.rateTable` で `renderRateTable` はひな型を
   描画する（`companyRateTableField` が隠れているため画面には出ない）。
2. **新規会社**: `newCompanyTemplate()` は従来通り `step_rate` 既定 →
   `applyCompanyPayrollModeUI()` で歩率テーブル表示。ユーザーが「固定部立」に
   切り替えると `onchange` で歩率テーブルが隠れ固定率が出る。
3. **保存**: `saveCompanyBtn` の onclick は従来通り `form` に `rateTable`
   （`collectRateTable` の結果）と `fixedRate` の両方を入れて `buildCompanyDoc`
   に渡す。`buildCompanyDoc` が `payrollMode` で取捨選択。固定部立時の歩率
   テーブルは `display:none` でもDOMに残るため `collectRateTable` は値を返すが、
   `buildCompanyDoc` が破棄するため無害。

### エラーハンドリング

- 固定部立で `fixedRate` 未入力／非数値 → `buildCompanyDoc` が
  `{ error: '...' }` を返し、保存ハンドラが赤字表示。
- 変動部立で `rateTable` 不正 → 同様にエラー。
- 既存のエラー表示・ステータス配色（緑／`#d32f2f`）はそのまま。

### テスト

`tests/admin-companies.test.js` を更新する。現行テスト
「`buildCompanyDoc: COMPANY_LEVEL_KEYS を全て含む`」はモード別検証と矛盾する
（変動部立 doc は `fixedRate` を持たず、固定部立 doc は `rateTable` を持たない）
ため差し替える:

- `step_rate` の doc は `rateTable` を含み `fixedRate` を含まない。
- `fixed_rate` の doc は `fixedRate` を含み `rateTable` を含まない。
- `fixed_rate` で `fixedRate` が空／非数値ならエラー。
- `step_rate` で `rateTable` が非オブジェクトならエラー。
- 共通必須項目（`takeHomeRate` 等）の欠落は両モードでエラー（既存ケース流用）。

DOM・表示切替（`applyCompanyPayrollModeUI`）はテスト対象外（既存方針どおり
DOM操作は単体テストしない）。

## 残論点

- なし（月給制はスコープ外と明示済み）。

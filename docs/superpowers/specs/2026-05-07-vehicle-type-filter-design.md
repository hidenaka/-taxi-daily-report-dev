# 車種別データ分割フィルター — 設計仕様

**作成日**: 2026-05-07
**対象**: タクシー日報アプリ（dev/prodデプロイ環境）
**スコープ**: A（車種別データ分割）— B（課金統合）／C（法的整備）は別spec

## 背景

複数ユーザーが同じデータリポジトリを共有して使うアプリで、`vehicleType` (`'japantaxi' | 'premium'`) は既に各乗務データに記録されている。しかし分析系ページでは車種混在で集計されており、「ジャパンタクシーでしかできない仕事」「プレミアムでしかできない仕事」を切り分けて参照できない。

知人を中心にした有料課金サービス展開（B spec）の前段として、まず車種別フィルタを5ページ横断で導入する。

## 要件まとめ

| 項目 | 決定事項 |
|---|---|
| 対象ページ | `index.html`, `review.html`, `support.html`, `calendar.html` |
| 対象外ページ | `detail.html`（単日表示）, `input.html`（入力）, `admin*.html`（管理者）, `bulk-input.html` |
| フィルタUI | 3タブ（すべて / ジャパンタクシー / プレミアム）の単一選択 |
| デフォルトタブ | 今日の乗務データ参照 → なければ `settings.defaults.vehicleType` → なければ `'all'` |
| 掛け持ち対応 | drive単位の `vehicleType` で振り分け（同一userが両タブに登場OK） |
| 不明データ | `'all'` タブのみ表示。JT/プレミアムからは除外 |
| 状態永続化 | sessionStorage（タブ間維持、ブラウザ閉じるとリセット） |
| Firestore変更 | なし（既存 `drive.vehicleType` をそのまま使用） |

## アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│ 各ページ (index/review/support/calendar)          │
│ ┌──────────────────────┐                         │
│ │ <vehicle-tabs> 設置箇所│ ← renderVehicleTabs()  │
│ └──────────────────────┘                         │
│              ↓                                    │
│   ページ固有の集計/描画関数                         │
│   const drives = filterDrivesByVehicle(           │
│     allDrives, getActiveVehicleType()             │
│   );                                              │
└──────────────────────────────────────────────────┘
                  ↑ ↓
┌──────────────────────────────────────────────────┐
│ js/vehicle-filter.js (新規)                       │
│  - getActiveVehicleType()                         │
│  - setActiveVehicleType(v)                        │
│  - resolveDefaultVehicleType()                    │
│  - renderVehicleTabs(container, options)          │
│  - filterDrivesByVehicle(drives, type)            │
│  - subscribeVehicleChange(cb)                     │
└──────────────────────────────────────────────────┘
                  ↑
┌──────────────────────────────────────────────────┐
│ sessionStorage: 'activeVehicleType'               │
│ + Firestore: drives/{userId}/{date}.vehicleType   │
│ + Firestore: config/{userId}.defaults.vehicleType │
└──────────────────────────────────────────────────┘
```

## コンポーネント仕様

### `js/vehicle-filter.js`（新規モジュール、ESM）

```javascript
// 内部状態
const STORAGE_KEY = 'activeVehicleType';
const VALID_TYPES = ['all', 'japantaxi', 'premium'];

// 公開API
export async function resolveDefaultVehicleType()
//  優先順:
//    1) 今日の乗務データの vehicleType（'japantaxi' or 'premium' に限る）
//    2) config.defaults.vehicleType（'japantaxi' or 'premium' に限る）
//    3) 'all'

export function getActiveVehicleType()
//  sessionStorage参照。VALID_TYPES外なら 'all' を返す

export function setActiveVehicleType(type)
//  バリデーション後に sessionStorage 保存 + 同ページ購読者にCustomEvent発火

export function renderVehicleTabs(container, options = {})
//  container: HTMLElement
//  options: { onChange?: (type) => void, showAll?: boolean (default true) }
//  3タブのHTMLを差し込み、active状態を視覚的にハイライト
//  クリックで setActiveVehicleType + onChange呼び出し

export function filterDrivesByVehicle(drives, type)
//  type === 'all'       → 全件返す
//  type === 'japantaxi' → d.vehicleType === 'japantaxi' のみ
//  type === 'premium'   → d.vehicleType === 'premium' のみ
//  'regular'（旧コードの値）は 'japantaxi' として扱う
//  空/null/undefined の vehicleType は 'all' でのみ含む

export function subscribeVehicleChange(callback)
//  同一ページ内でタブ切替を検知。返り値はunsubscribe関数
```

### 初期化フロー（各ページ共通）

```
ページ読み込み
  ↓
auth初期化 → drives取得（既存処理）
  ↓
if (sessionStorage に有効値が無い)
  await resolveDefaultVehicleType() → setActiveVehicleType
  ↓
renderVehicleTabs(container, { onChange: rerenderPage })
  ↓
最初の描画（フィルタ適用済み）
```

### 各ページの設置場所

| ページ | タブ設置場所 | フィルタ適用先 |
|---|---|---|
| `index.html` | トップサマリ直下（既存"今月のサマリ"の上） | 月次集計、ペース予測、シミュレーション |
| `review.html` | h1「分析」直下 | ヒートマップ、ランキング、トレンド、メモ一覧 |
| `support.html` | 期間表示の下 | 全員統合系（推奨検索、エリア効率、降車分析） + 自分データ系 |
| `calendar.html` | カレンダー上部 | 月のセル色・サマリ |

### CSS（`css/style.css` 追記）

```css
.vehicle-tabs { display: flex; gap: 4px; margin: 8px 0; }
.vehicle-tabs button {
  flex: 1; background: #f0f0f0; color: #333; border: none;
  padding: 8px; border-radius: 4px; font-size: 12px; cursor: pointer;
}
.vehicle-tabs button.active {
  background: var(--primary); color: #fff; font-weight: 600;
}
```

## データフロー

```
[ユーザー操作: タブ切替]
       ↓
setActiveVehicleType('premium')
       ↓
sessionStorage 更新 + 購読者にCustomEvent発火
       ↓
ページ側 onChange ハンドラ実行
       ↓
const filtered = filterDrivesByVehicle(allDrives, 'premium')
       ↓
既存の集計関数に filtered を渡す
       ↓
チャート/テーブル/ヒートマップ再描画
```

**重要**: `allDrives`（フェッチ済み生データ）は保持し、フィルタは**メモリ上で**かけ直す。Firestoreへの再アクセスはしない。

## エッジケース処理

| ケース | 挙動 |
|---|---|
| 今日まだ乗務データがない & settings未設定 | デフォルトタブは `'all'` |
| 今日の乗務が `vehicleType: ''`（空） | settings の defaults.vehicleType を参照 |
| settings も空 | `'all'` |
| フィルタ後の drives が0件 | 既存の「データなし」表示にフォールバック（各ページ実装済み） |
| support.html: 全員統合 → プレミアム選択 → 該当ドライブ0件 | 「対象車種のデータがありません」を表示 |
| 掛け持ちユーザー（同一user_idで両車種） | drive単位で振り分け済み。タブ切替で自動的に対応 |
| sessionStorage が無効（プライベートモード等） | フォールバックで in-memory 変数を使う（タブ切替後の永続性は失われるがエラーは出ない） |
| `vehicleType` が `'regular'`（古いコードで一時的に使っていた値） | `'japantaxi'` として扱う |

## 月度跨ぎ・期間切替との相互作用

- 期間タブ（review.html の `range-tabs`）と車種タブは**直交**して動く
- 期間変更 → 新しい drives を取得 → 現在の車種フィルタを適用
- 車種変更 → 既存の drives にフィルタ適用（再取得なし）

## support.html 特有の考慮

`getAllUsersDrivesForMonth` で取得した `allDrives` 配列は全ユーザー混在。フィルタ後でも:
- 「全員モード: Nユーザー / 合計M乗務(自分: K乗務)」の表示で N も再計算（フィルタ後の active user数）
- `(自分: K乗務)` の K もフィルタ後の値に再計算

## テスト戦略

### `tests/vehicle-filter.test.js`（新規、`node --test`）

1. `filterDrivesByVehicle`
   - `'all'` → 全件返す
   - `'japantaxi'` → JTのみ
   - `'premium'` → プレミアムのみ
   - 空 vehicleType は `'all'` でのみ含まれる
   - `'regular'` 値は `'japantaxi'` として扱われる
2. `resolveDefaultVehicleType`
   - 今日の乗務がある → その値
   - 今日の乗務なし、config あり → config値
   - 両方なし → `'all'`
   - 不正な値（`'taxi'` 等）は `'all'` にフォールバック
3. `setActiveVehicleType`
   - 無効値（`'unknown'`）渡しても保存されない
   - 有効値で sessionStorage に正しく保存
   - 購読者にイベントが届く

UIテストは既存 Playwright MCP で確認可能だが、手動確認で十分とする。

## 実装範囲

| # | ファイル | 種別 | 内容 |
|---|---|---|---|
| 1 | `js/vehicle-filter.js` | 新規 | 共通モジュール（API一式） |
| 2 | `tests/vehicle-filter.test.js` | 新規 | ユニットテスト |
| 3 | `css/style.css` | 編集 | `.vehicle-tabs` スタイル追記 |
| 4 | `index.html` | 編集 | タブ設置 + 集計関数にフィルタ注入 |
| 5 | `review.html` | 編集 | タブ設置 + 各セクションにフィルタ注入 |
| 6 | `support.html` | 編集 | タブ設置 + 全員統合/自分データ両方にフィルタ注入 + ユーザー数再計算 |
| 7 | `calendar.html` | 編集 | タブ設置 + 月セル描画にフィルタ注入 |

## スコープアウト

- `detail.html`（単日表示）
- `input.html` / `bulk-input.html`（入力ページ）
- `admin.html` / `admin-settings.html`（B課金統合spec で別途扱う）
- 課金システム（B spec）
- 法的整備（C spec）

## 成功基準

ユーザーが手動で確認:

- [ ] 各ページでタブ切替がスムーズに動く（再フェッチなし）
- [ ] デフォルトタブが「今日の乗務 → settings → すべて」の優先順で正しく決まる
- [ ] 掛け持ちユーザーが両タブで適切に表示される
- [ ] 不明 `vehicleType` のドライブが「すべて」のみで見える
- [ ] support.html の「全員モード: Nユーザー / 合計M乗務」がフィルタ後の値で正しく更新
- [ ] sessionStorage で同セッション内のページ遷移後もタブ選択が維持
- [ ] 期間タブと車種タブが独立して動く
- [ ] `npm test` で `tests/vehicle-filter.test.js` がパス
- [ ] dev環境（`-dev` URL）で動作確認後、タグpushで本番デプロイ

## デプロイ手順

既存ルール（`AGENTS.md`）に従う:

1. dev リポジトリで実装 → コミット → push
2. `https://hidenaka.github.io/-taxi-daily-report-dev/` で動作確認
3. 確認OK後、タグ付け（例: `v1.x.0`）→ 自動デプロイで本番反映

## B/C への引き継ぎメモ

このspecで `vehicleType` フィルタが完成すると、B（課金統合）で「JT-only プラン / Premium-only プラン / 両方プラン」のような価格設計が将来可能になる素地ができる。filterモジュールは課金プラン制御にも再利用できる。

C（法的整備）は B 着手前に別specで進める前提。

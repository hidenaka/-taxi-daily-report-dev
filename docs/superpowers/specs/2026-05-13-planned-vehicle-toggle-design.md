# 予定セルの車種トグル — 設計仕様

**作成日**: 2026-05-13
**対象**: タクシー日報アプリ（dev/prod デプロイ環境）
**スコープ**: カレンダー予定セルへの車種(JT/プレミアム)埋め込みと、ホーム表示への反映

## 背景

`calendar.html` ではタップ循環 `未 → 予定 → 有給 → 未` で日次予定を入力する。現状の予定状態には車種が紐付かず、`config.shifts.expandedDates: string[]` に日付しか保存しない。

一方、上部に車種フィルタタブ（すべて / JT / プレミアム）があり、これは「分析の絞込み」であって入力ではない。ユーザーから見ると「JT とプレミアムを同じ日に両方入れられる仕様」に映り、また予定段階で車種が指定できないため当日どの車に乗る予定だったかが視覚的に分からない。

本 spec では、予定セル自体に車種を内包させ、タップ循環で **排他的に** どちらかを選ばせる。色で車種を読み取れるようにする。ホーム画面のカレンダー表示も同じ車種が一目で分かるよう拡張する。

## 要件まとめ

| 項目 | 決定事項 |
|---|---|
| 対象セル | 予定セルのみ（実績／有給は据え置き） |
| 状態循環 | `未 → デフォルト車種予定 → 非デフォルト車種予定 → 有給 → 未` |
| 排他性 | 同一日に JT と プレミアム を両方入れることは構造的に不可（マップ1キー1値） |
| デフォルト車種 | `config.defaults.vehicleType`（`'japantaxi'` / `'premium'`） |
| 色 | プレミアム予定: `#1976d2`（青） / JT予定: `#26c6da`（水色） |
| 実績セル | 現状維持（`var(--primary)` 青、変更不可） |
| 有給セル | 現状維持（`#ce93d8` 紫） |
| カレンダー上部の車種フィルタタブ | **削除**（calendar.html のみ。他ページは現状維持） |
| ホーム表示 | 予定セルは車種色、実績セルに `J`/`P` バッジを右上に付与 |
| データ構造 | `config.shifts.plannedVehicles: Record<DateISO, 'japantaxi'\|'premium'>` を追加 |
| 既存データ移行 | バックフィルしない。`expandedDates` にあって `plannedVehicles` に無い日付はデフォルト車種扱いでフォールバック描画 |
| 影響ページ | `calendar.html`, `index.html`（他ページの車種フィルタには影響なし） |

## アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│ calendar.html                                     │
│  - 上部の車種フィルタタブ削除                       │
│  - セル描画: planned-shifts.js の helper で車種解決 │
│  - タップ: cycleShiftState() の結果で config 更新    │
│  - 曜日一括: 追加時に plannedVehicles[d]=default  │
├──────────────────────────────────────────────────┤
│ index.html                                        │
│  - renderCalendar の予定セルに車種クラス付与         │
│  - 実績セル右上に J/P バッジ                       │
├──────────────────────────────────────────────────┤
│ js/planned-shifts.js（新規・純粋関数群）             │
│  - cycleShiftState(current, defaultType)         │
│  - getPlannedVehicle(date, config)                │
│  - setPlannedVehicle(config, date, vehicle)       │
│  - removePlanned(config, date)                    │
├──────────────────────────────────────────────────┤
│ Firestore: config/{userId}                        │
│  - shifts.plannedVehicles  (新規フィールド)         │
│  - shifts.expandedDates    (既存維持)              │
│  - shifts.paidLeaveDates   (既存維持)              │
└──────────────────────────────────────────────────┘
```

## データモデル

`config.shifts` を以下に拡張:

```jsonc
{
  "shifts": {
    "patterns": ["mon", "wed"],
    "expandedDates": ["2026-05-12", "2026-05-14"],
    "paidLeaveDates": ["2026-05-10"],
    "plannedVehicles": {              // 新規
      "2026-05-12": "premium",
      "2026-05-14": "japantaxi"
    },
    "exceptions": { "added": [], "removed": [], "swapped": [] }
  }
}
```

### 不変条件

- 任意の日付 `d` について以下のうち高々1つだけが真:
  1. `expandedDates` に `d` を含む（予定）
  2. `paidLeaveDates` に `d` を含む（有給）
- `plannedVehicles` のキーは原則 `expandedDates` の要素と同じ集合。`getConfig()` 直後に `pruneOrphanVehicles(config)` で `plannedVehicles` の余分なキーを削除する（防御的）
- 値は `'japantaxi'` または `'premium'` のみ

### マイグレーション

- 既存 config に `plannedVehicles` が無い → ロード時に `{}` で初期化（書き込みはしない）
- 既存 `expandedDates` の各日付について `plannedVehicles[d]` が未定義 → 描画時に `config.defaults.vehicleType` で代用（永続化しない）
- ユーザーが該当日をタップした瞬間に、循環の結果として `plannedVehicles[d]` が明示的に保存される

## 状態遷移

タップで以下を循環（実績済日は変更不可）:

```
[未]
  ↓ tap
[予定: defaults.vehicleType]
  ↓ tap
[予定: もう一方の車種]
  ↓ tap
[有給]
  ↓ tap
[未]
```

`defaults.vehicleType` が `'japantaxi'` の場合: `未 → JT予定 → プレ予定 → 有給 → 未`
`defaults.vehicleType` が `'premium'` の場合: `未 → プレ予定 → JT予定 → 有給 → 未`

実装の純粋関数:

```javascript
// 状態: { planned: bool, vehicle: 'japantaxi'|'premium'|null, paid: bool }
export function cycleShiftState(current, defaultType) {
  const other = defaultType === 'japantaxi' ? 'premium' : 'japantaxi';
  if (!current.planned && !current.paid) {
    return { planned: true, vehicle: defaultType, paid: false };
  }
  if (current.planned && current.vehicle === defaultType) {
    return { planned: true, vehicle: other, paid: false };
  }
  if (current.planned && current.vehicle === other) {
    return { planned: false, vehicle: null, paid: true };
  }
  // paid → 未
  return { planned: false, vehicle: null, paid: false };
}
```

## 色設計（CSS 追記）

```css
/* css/style.css */
.cal-cell { position: relative; }                            /* バッジ配置用 */
.cal-cell.planned.japantaxi {
  background: #26c6da; color: #fff;
  border-color: #00acc1; font-weight: 600;
}
.cal-cell.planned.premium {
  background: #1976d2; color: #fff;
  border-color: #0d47a1; font-weight: 600;
}
.cal-cell.actual .vt-badge,
.cal-cell .vt-badge {
  position: absolute; top: 2px; right: 2px;
  font-size: 9px; font-weight: 700; line-height: 1;
  padding: 2px 4px; border-radius: 3px;
  background: rgba(255,255,255,.85); color: #333;
  pointer-events: none;
}
```

実績セルの背景色（`var(--primary)` 青）は変更しない。プレ予定の青（`#1976d2`）と近接するが、文脈（過去＝実績／未来＝予定）と「実績セルにのみ売上額・天気アイコンを表示」で識別可能。

## コンポーネント仕様

### `js/planned-shifts.js`（新規モジュール、ESM）

```javascript
const VALID_VEHICLES = ['japantaxi', 'premium'];

export function isValidVehicle(v) { return VALID_VEHICLES.includes(v); }

export function getPlannedVehicle(date, config) {
  if (!config?.shifts?.expandedDates?.includes(date)) return null;
  const explicit = config.shifts.plannedVehicles?.[date];
  if (isValidVehicle(explicit)) return explicit;
  const fallback = config.defaults?.vehicleType;
  return isValidVehicle(fallback) ? fallback : 'japantaxi';
}

export function getShiftStateForDate(date, config) {
  const planned = config?.shifts?.expandedDates?.includes(date) ?? false;
  const paid = config?.shifts?.paidLeaveDates?.includes(date) ?? false;
  const vehicle = planned ? getPlannedVehicle(date, config) : null;
  return { planned, vehicle, paid };
}

export function cycleShiftState(current, defaultType) { /* 上記の通り */ }

export function applyShiftState(config, date, next) {
  // expandedDates / paidLeaveDates / plannedVehicles を一括更新
  config.shifts.expandedDates = config.shifts.expandedDates || [];
  config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
  config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
  const removeFrom = (arr, d) => {
    const i = arr.indexOf(d);
    if (i >= 0) arr.splice(i, 1);
  };
  removeFrom(config.shifts.expandedDates, date);
  removeFrom(config.shifts.paidLeaveDates, date);
  delete config.shifts.plannedVehicles[date];
  if (next.planned) {
    config.shifts.expandedDates.push(date);
    config.shifts.expandedDates.sort();
    config.shifts.plannedVehicles[date] = next.vehicle;
  } else if (next.paid) {
    config.shifts.paidLeaveDates.push(date);
    config.shifts.paidLeaveDates.sort();
  }
  return config;
}

export function pruneOrphanVehicles(config) {
  if (!config?.shifts?.plannedVehicles) return config;
  const planned = new Set(config.shifts.expandedDates || []);
  for (const d of Object.keys(config.shifts.plannedVehicles)) {
    if (!planned.has(d)) delete config.shifts.plannedVehicles[d];
  }
  return config;
}
```

### `calendar.html` 変更点

1. `#vehicleTabsContainer` 削除、`vehicle-filter.js` の import / `renderVehicleTabs` 呼び出しを削除
2. `drivesThisMonth = filterDrivesByVehicle(...)` を `drivesThisMonth = rawDrivesThisMonth` に置換（フィルタなし）
3. セル描画ループで `getPlannedVehicle(iso, config)` を呼び、結果に応じて `.japantaxi` / `.premium` クラスを付与
4. `cycleStatus(iso)` を `cycleShiftState` + `applyShiftState` の呼び出しに置換
5. `renderDowToggles` で「曜日 ON 時に展開する日付」追加処理で同時に `config.shifts.plannedVehicles[d] = config.defaults.vehicleType` をセット
6. 凡例セクションを以下に差し替え:
   ```
   ■(青) 実績  ■(水色) JT予定  ■(青) プレ予定  ■(紫) 有給  ▢(オレンジ枠) 今日
   ```
7. ヘルプ文を「タップで未→[デフォルト車種]→[もう一方]→有給→未と循環。実績入力済の日は変更不可」に更新

### `index.html` 変更点

1. `renderCalendar` 内で `getPlannedVehicle(iso, config)` を呼び、予定セルに `.japantaxi` / `.premium` クラスを付与
2. 予定セル・実績セルともに `drive.vehicleType` または `plannedVehicles[iso]` から `J` / `P` バッジを右上に付与（色だけだとプレ予定と実績が紛らわしいため、識別はバッジ統一で行う）
   - 予定セル: `<span class="vt-badge">${vehicle === 'premium' ? 'P' : 'J'}</span>`
   - 実績セル: `<span class="vt-badge">${drive.vehicleType === 'premium' ? 'P' : 'J'}</span>`
   - `drive.vehicleType` が空・不正値の実績はバッジ非表示
3. 凡例セクションを以下に差し替え:
   ```
   ■(青)実績  ■(水色)JT予定  ■(青)プレ予定  ■(紫)有給   バッジ J=JT / P=プレ
   ```
4. `config = await getConfig()` 直後に `config.shifts.plannedVehicles ??= {}` の正規化と `pruneOrphanVehicles(config)` を呼ぶ

### `js/default-config.js` 変更点

```javascript
shifts: {
  patterns: [],
  exceptions: { added: [], removed: [], swapped: [] },
  expandedDates: [],
  paidLeaveDates: [],         // 既存実装で初期化済の場合は重複定義しない
  plannedVehicles: {}         // 新規
}
```

## データフロー

```
[ユーザー操作: 予定セルタップ]
       ↓
getShiftStateForDate(iso, config)   ← 現状読み取り
       ↓
cycleShiftState(current, defaults.vehicleType)
       ↓
applyShiftState(config, iso, next)  ← config 上書き
       ↓
saveConfig(config)                  ← Firestore 保存
       ↓
render()                            ← 再描画
```

## エッジケース処理

| ケース | 挙動 |
|---|---|
| `config.defaults.vehicleType` が空・不正値 | フォールバックで `'japantaxi'` を default 扱い |
| 既存の `expandedDates` 日付（`plannedVehicles` 未指定） | 描画時は default 車種色。タップで明示状態に遷移し永続化される |
| `expandedDates` から手動削除されたが `plannedVehicles` に残ったキー | `pruneOrphanVehicles` で `getConfig` 直後に掃除 |
| 実績済（`drives` に該当日あり）でタップ | 現状通り `alert` で拒否 |
| Firestore オフライン | 既存の `saveConfig` キュー機構に任せる（変更なし） |
| `drive.vehicleType` が空・不正値の実績セル（ホーム） | バッジ非表示 |

## 期間切替（前月/翌月）との相互作用

- `expandedDates` / `plannedVehicles` は全期間のフラットな保存。`getBillingPeriodRange(viewPeriod)` でフィルタするのは描画側の責務（既存通り）
- 期間が変わってもメモリ上の `config` を再利用、`render()` のみ再実行（既存挙動を維持）

## テスト戦略

### `tests/planned-shifts.test.js`（新規、`node --test`）

1. `cycleShiftState` — 全遷移
   - `defaultType='japantaxi'`: 未→JT予定→プレ予定→有給→未 の4遷移
   - `defaultType='premium'`: 未→プレ予定→JT予定→有給→未 の4遷移
   - 不正な current 状態 → 未にフォールバック
2. `getPlannedVehicle`
   - `expandedDates`にある + `plannedVehicles`明示 → その値
   - `expandedDates`にある + `plannedVehicles`未指定 → `defaults.vehicleType`
   - `expandedDates`にある + `defaults.vehicleType`不正 → `'japantaxi'`
   - `expandedDates`に無い → `null`
3. `applyShiftState`
   - 未 → 予定: `expandedDates` と `plannedVehicles[date]` の両方が追加
   - 予定 → 有給: `expandedDates` と `plannedVehicles[date]` から削除、`paidLeaveDates` に追加
   - 有給 → 未: `paidLeaveDates` から削除
   - 重複追加が起きない
4. `pruneOrphanVehicles`
   - `expandedDates` に無い `plannedVehicles` キーが削除される

UI テスト（calendar.html / index.html）は手動 + Playwright MCP で dev 環境にて確認。

## 実装範囲（タスク化）

| # | ファイル | 種別 | 内容 |
|---|---|---|---|
| 1 | `js/planned-shifts.js` | 新規 | 純粋関数群 |
| 2 | `tests/planned-shifts.test.js` | 新規 | ユニットテスト |
| 3 | `js/default-config.js` | 編集 | `plannedVehicles: {}` 追加 |
| 4 | `css/style.css` | 編集 | `.planned.japantaxi` / `.planned.premium` / `.vt-badge` 追記 |
| 5 | `calendar.html` | 編集 | フィルタタブ削除 / 循環ロジック差し替え / 曜日一括の車種同時セット / 凡例更新 |
| 6 | `index.html` | 編集 | `renderCalendar` で車種クラス・バッジ付与 / 凡例更新 |

## スコープアウト

- `review.html` / `support.html` の車種フィルタ（既存のまま）
- 実績セルの色を JT/プレで分ける（プレ予定の青と被るが、本 spec ではバッジで識別する設計）
- 既存 `expandedDates` の一括バックフィル
- 入力フォーム（`input.html`）側の挙動変更
- 課金（B spec）への影響

## 成功基準

ユーザーが dev 環境（`-dev` URL）で手動確認:

- [ ] `calendar.html` の上部車種フィルタタブが消えている
- [ ] 予定セルが車種ごとに色分けされる（プレ=青 / JT=水色）
- [ ] タップで `未 → デフォルト車種予定 → 非デフォルト車種予定 → 有給 → 未` の順に循環
- [ ] `settings.html` の「デフォルト車種」を JT に変えると、タップの最初の遷移先が JT予定 になる（プレに変えれば プレ予定 が先）
- [ ] 曜日一括追加で展開された日付が、設定デフォルト車種の色になる
- [ ] 同一日に JT と プレ の両方が立つ状態を作れない（構造的に不可能）
- [ ] ホームカレンダーの予定セルが車種色になる
- [ ] ホームカレンダーの実績セル右上に `J` / `P` バッジが出る
- [ ] 既存の有給セル（紫）・実績セル（青）の挙動は壊れていない
- [ ] `npm test` で `tests/planned-shifts.test.js` がパス
- [ ] 既存の `tests/vehicle-filter.test.js` もパス（他ページのフィルタは無変更）

## デプロイ手順

既存ルール（`AGENTS.md`）に従う:

1. dev リポジトリで実装 → コミット → push
2. `https://hidenaka.github.io/-taxi-daily-report-dev/` で動作確認（calendar / index）
3. ユーザー OK 後、タグ付け → 本番デプロイ

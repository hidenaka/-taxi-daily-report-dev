# 乗り場別 同条件過去比較 Design

> 2026-05-27 設計。前提: 誠実再設計（v1.36.0、`activity.sameConditionCompare`）が本番反映済み。本設計はその stall 別版拡張。

## 背景

ユーザー（運用者）から「第3乗り場の動き（出庫数）が異様に多いように見える」という指摘があった。調査の結果：

- ROI座標重なりは無く、`stall-slots.json` の stall3 スロット定義は2列×8台の対角線配置で物理運用と整合
- 出庫計算ロジックも `stall全体 occ の時系列差分` で構造的に正しく、繰り上がり移動は偽出庫にならない
- 「stall3 27台/h は実態（火曜16時台 ANA T2活発）か、検出系の局所偽陽性か」**判断材料が乏しい**

現状の `activity.sameConditionCompare` は**全乗り場合計**の過去同条件比較のみで、stall別の比較ができない。「stall3 だけ普段の +50%」なら異常、「+5%」なら実態、と一目で切り分けられる材料が必要。

本設計はその切り分け材料を、最小コストで追加する。

---

## 目的（成功基準）

1. 乗務員が各乗り場の出庫数を「普段（同曜日・同時間帯）と比べて活発／少なめ／普通」で判断できる
2. ROI 座標や検出ロジックには触れない（既存の構造的整合は維持）
3. 既存テストを壊さない（後方互換）

---

## 設計原則

- 既存 `activity.sameConditionCompare` の構造をそのまま **stall別に複製**（学習コストゼロ）
- ic-helper 側に純関数を1つ追加 + `buildStalls` への組み込みのみ
- UI 側は `formatStallLineV2` を拡張するのみ（render は変更しない）
- サンプル不足時の fallback は既存と同じく `peers_typical/percent/label = null, dayLabel = '...'`

---

## データ構造変更

`pool-status.json` の `stalls.*` に `sameConditionCompare` を追加:

```json
"stalls": {
  "stall1": {
    "label": "第1乗り場",
    "terminal": "T1",
    "occ": 8,
    "recent1hDep": 17,
    "waitMin": 28,
    "trend": "down",
    "rankHint": "most-low",
    "sameConditionCompare": {
      "peers_typical": 22,
      "percent": -23,
      "label": "いつもより少なめ",
      "dayLabel": "火曜平日"
    }
  },
  ...
}
```

### 既存 `activity.sameConditionCompare` との関係

| 項目 | activity 全体 | stalls.* (新規) |
|---|---|---|
| 計算対象 | `recent1hDepartures` (全体合計) | `recent1hDep` (その stall のみ) |
| 過去サンプル抽出 | 同(weekday, dayKind)・同時間帯の全体 | 同(weekday, dayKind)・同時間帯の **その stall** |
| ラベル閾値 | ±15% で `いつもより活発/少なめ/通り` | 同じ |
| Fallback | サンプル < 3 で null | 同じ |

### 内部関数

`sameConditionCompare(rows, now, holidays, weeks=4, stallKey=null)` を一般化:

- **既存挙動 (stallKey=null)**: 現在の `recent1hAt(rows, atDate)` を内部で呼び、全体 `recent1hDepartures` の中央値を計算
- **拡張 (stallKey 指定)**: 内部で `stallDepartures(rows, atDate, 60)[stallKey]` を呼び、その stall の1h出庫合計の中央値を計算
  - `stallDepartures` は Task A4 で追加済みの内部関数（既存）
- 残りのロジック（過去4週同条件サンプル抽出、中央値、percent計算、ラベル閾値、fallback）は完全に共通

これにより**実装の差分は最小**で、既存テストも壊れない（引数省略時は既存挙動）。

---

## UI 表示

`formatStallLineV2(stall)` を拡張:

```
第1乗り場  少なめ↓ ← 最も少なめ（いつもの -23%）
第2乗り場  横ばい→
第3乗り場  活発↑ ← 最も活発（いつもの +5%）
第4乗り場  少なめ↓
```

優先順位（条件分岐）:

| `rankHint` | `sameConditionCompare.percent` | 表示 |
|---|---|---|
| `most-active` | number | `<label>  <trend> ← 最も動き活発（いつもの ±N%）` |
| `most-low` | number | `<label>  <trend> ← 最も動き少なめ（いつもの ±N%）` |
| null | number | `<label>  <trend>（いつもの ±N%）` |
| `most-active` | null (サンプル不足) | `<label>  <trend> ← 最も動き活発` （既存と同じ） |
| `most-low` | null | `<label>  <trend> ← 最も動き少なめ` （既存と同じ） |
| null | null | `<label>  <trend>` （既存と同じ） |

`percent` の符号（既存 `formatActivityLine` と同ルール）:
- `>= 0` → `+`プレフィックス + 整数（`+5%`, `+0%`）
- `< 0` → そのまま負号付き整数（`-23%`）
- 既存実装と同じく `Math.round(sc.percent)` で整数化済み

---

## 実装範囲

### Phase A — `~/repos/taxi-ic-helper`

- **A1**: `sameConditionCompare` を一般化（第5引数 `stallKey` 追加、`null` で既存挙動）
- **A2**: `buildStalls` 内で各 stall に `sameConditionCompare` を計算して付与（holidays 省略時は null）
- **A3**: `buildPoolStatus` 経由で出力フィールド確認、後方互換テスト追加、publish 配線確認

### Phase B — `~/work/taxi-dev-wt-pool-status`

- **B1**: `formatStallLineV2` 拡張＋テスト追加（上記表の全パターン）
- **B2**: `sw.js` CACHE_NAME bump

### Phase C — 反映

- ic-helper push（Claude実行可）→ Mac mini pull → dev反映（PUSH-genkyo.sh）→ 本番 v1.37.0タグ

---

## テスト

### Phase A（ic-helper）

```js
test('sameConditionCompare: stallKey 指定で stall別出庫の中央値を比較', () => {
  // (今日の stall3 dep) と (過去3週の火曜平日の stall3 dep median) で比率算出
  // 期待: peers_typical, percent, label, dayLabel
});

test('sameConditionCompare: stallKey 未指定（既存挙動）が壊れない', () => {
  // 既存テストが pass し続ける
});

test('buildStalls: 各 stall に sameConditionCompare フィールドが追加される', () => {
  // holidays あり → percent number or null
  // holidays なし → sameConditionCompare = null
});
```

### Phase B（日報UI）

```js
test('formatStallLineV2: rankHint+percent あり', () => {
  // expect: '第3乗り場  活発↑ ← 最も動き活発（いつもの +5%）'
});

test('formatStallLineV2: rankHint なし+percent あり', () => {
  // expect: '第2乗り場  横ばい→（いつもの -2%）'
});

test('formatStallLineV2: percent null fallback（既存挙動）', () => {
  // expect: '第3乗り場  活発↑ ← 最も動き活発'
});
```

---

## 残課題（本設計の範囲外）

- **過去サンプル蓄積**: 現状 slot-occupancy-history.jsonl は2週間程度。各 (weekday, dayKind) で過去3サンプル以上が揃うまで（1〜2ヶ月）は多くの時間帯で fallback 表示になる。これは時間が解決
- **検出系の精度改善（YOLO主系昇格）**: ROI座標自体は妥当だが、`detect_vehicles.py` を主系にすることで局所偽陽性を低減する余地。別タスク
- **stall別 typical1h の出力**: percent 計算の中身（実際の今日値 / peers_typical 値）を出すと、デバッグや透明性が増す。現状は内部のみ

---

## 成功基準（再掲）

- pool-status.json の各 stalls.* に `sameConditionCompare` が正しく出力される
- 古い JSON（フィールド無し）でも UI が壊れずグレースフルに縮退
- UI で各乗り場の動きが「普段との比較」で判断できる
- ic-helper 569件 + 日報 574件のテストがすべて緑のまま

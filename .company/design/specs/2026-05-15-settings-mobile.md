---
created: "2026-05-15"
component: 設定画面 (settings.html)
status: implemented
tags: [settings, mobile, form-ui]
---

# 設定画面 モバイル最適化

## 課題(改修前)
- 「デフォルト」セクションに目標3つを含む雑多な設定が混在 → 探しづらい
- input が小さい(font-size 暗黙、padding狭い)
- iOS Safariで input にフォーカスすると自動ズーム発生(font-size 16px未満のため)
- ラベルが muted 11px のままで、入力との関係が薄い
- ヘルプ文と本文の階層が弱い
- タップ範囲が狭い

## 改修方針

### 1. セクション再構成
- アカウント (変更なし)
- **基本設定** (旧「デフォルト」): 乗務種別 / 出庫時刻 / 手取り率 / 有給金額
- **🎯 目標** (新規分離): 手取り目標 / 総支給目標 / 11乗務目までの手取り目標
- 天候地点 / 管理者ツール / レートテーブル / 退会 (変更なし)

### 2. CSS統一クラス
- `.setting-group` 1項目の縦余白
- `.setting-label` ラベル 13px 600 #374151
- `.setting-label .optional` 「任意」バッジ
- `.setting-input` / `.setting-select` 入力フィールド
  - **font-size 16px** (iOS自動ズーム防止)
  - padding 11px 12px (タップ範囲確保)
  - border-radius 8px
  - focus時 outline 2px rgba(primary, 0.15)
- `.setting-help` ヘルプ文 11px #6b7280

### 3. 目標セクションのアクセント
- `.target-card` 左ボーダー3px 青、右へグラデーション背景
- 「🎯 目標」絵文字でセクションの役割を視覚化

### 4. inputmode 属性で数値キーボード
- 金額入力: `inputmode="numeric"`
- 手取り率: `inputmode="decimal"`
→ スマホでの入力が楽

## 効果
- 縦スクロール量は同じだが、見た目の整理で項目を探しやすい
- 入力フィールドが大きく、タップしやすい
- 目標が「設定の目玉機能」として視認可能

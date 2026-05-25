# タクシープール現況（混み具合・今日の流れ）＋出庫 — 設計

作成: 2026-05-25

## 目的
到着便ページの「タクシー出庫」を、ドライバーが**今この瞬間に判断できる現況**主役へ拡張する。
- 空港タクシープールが**どれだけ埋まっているか（在台数＝混み具合）**を、実写と数値で見せる。
- **今日の流れが活発か**（直近の出庫ペース vs 平常）を見せる。
- 出庫実績は維持。予測は精度が未達のため「目安（学習中）」と明示して併記（控えめ）。

## 背景（前提・確定事項）
- 占有計測は **fill 自動較正（slot-occupancy）** が正確（在台数を信頼して出せる）。
- 予測は別系統（taxi-pool-history）で動き精度未達（2026-05-25 時点 patternMatch lead30 MAE≈5.5）。
  本設計では予測は「目安」として残すのみで、主役にしない。
- 乗務員UIは**日報アプリ `tools/`**。taxi-ic-helper のUIは廃止済み。データは
  `taxi-ic-helper` → `relay-taxi-data.yml` → 日報リポ `tools/data/` の経路。

## 全体構成（2リポにまたがる）

### A. taxi-ic-helper（計測・配信）
新「現況バンドル」を `data/` に生成し、relay で日報 `tools/data/` へ配信する。

1. **サムネ画像 2 枚**: `pool-cam-real01.jpg` / `pool-cam-real02.jpg`
   - 最新アーカイブフレームを**約480px幅・JPEG q≈70**に縮小（1枚 ~30-50KB 目安）。
   - 同名で上書き（git 肥大を抑制。許容範囲とする）。
2. **`pool-status.json`**:
   ```json
   {
     "generatedAt": "ISO8601",
     "cameras": {
       "real01": { "occ": 42, "fullRef": 50, "level": "crowded" },
       "real02": { "occ": 8,  "fullRef": 12, "level": "normal" }
     },
     "total": { "occ": 50, "level": "crowded" },
     "activity": { "recent1hDepartures": 38, "typical1h": 28, "level": "active", "arrow": "up" }
   }
   ```
   - `occ`（在台数・現在）= slot-occupancy 最新の平滑 occ（computeSlotActuals と同じ平滑化、夜は持続判定）。real01 = stall1+2+3+4(front)、real02 = stall4_back。
   - `fullRef`（満車基準）= **直近7日**（不足時は全fill履歴）の occ の **92パーセンタイル**で自己較正
     （full_ref autocal と同思想）。下限クランプ（例: real01=20, real02=4）で履歴薄時の暴れを防ぐ。
   - `level`: occ/fullRef を 空き(<0.30)/普通(0.30-0.65)/混雑(0.65-0.90)/満車(≥0.90) に写像。
   - `activity`: 直近1h の出庫合計（fill 実績 15分スロット直近4本の合計）と、**平常**＝直近7日の
     同じ1時間枠の出庫合計の中央値、を比較。比 ≥1.25→活発↑ / 0.75-1.25→平常→ / <0.75→少なめ↓。
     平常=0 の時間帯は arrow=→（0除算ガード）。

3. **生成タイミング**: `observe-tick-local.sh`（5分毎）に小ステップを追加。
   既存の観測・データ生成の後、サムネ書き出し＋`pool-status.json` 生成→ commit（既存の data commit に同梱）。
4. **relay**: `relay-taxi-data.yml` の配信 FILES に `pool-cam-real01.jpg pool-cam-real02.jpg pool-status.json` を追加し、日報リポ(dev/prod)の `tools/data/` へコピー。

### B. 日報アプリ（UI `tools/`）
1. `tools/arrivals.html`: 出庫セクション最上部に「現況」ブロックを追加。
   - 見出し「🚕 タクシープール現況・出庫」。
   - 写真2枚（`data/pool-cam-real01.jpg` / `real02.jpg`、相対パス、`?t=` でキャッシュ回避、遅延ラベル「直近(数分前)」）。
   - 混み具合: レベルバッジ（空き/普通/混雑/満車）＋「在台 約N台」。
   - 今日の流れ: 活発↑/平常→/少なめ↓ ＋「直近1h 出庫N台 / 平常M台」。
   - データ古い（pool-status.generatedAt が閾値超）時は「配信停止中」表示（既存 STALE 同様）。
2. 新 `tools/js/pool-status-section.js`（`pool-status.json` 取得・描画、画像 src 設定、自動更新）。
   `arrivals-app.js` が初期化時に1回呼ぶ（既存 forecast-section と並列）。
3. **出庫実績テーブルは現状維持**。**予測モードのラベルを「予測（目安・学習中）」に変更**して残す
   （撤去はしない。控えめ表示）。ⓘ 説明はそのまま「目安」を明記。
4. `sw.js`: `CACHE_NAME` を bump、precache 一覧に `tools/js/pool-status-section.js` を追加。
   サムネ/`pool-status.json` は `cache:'no-store'` 取得（precache しない）。

## レイアウト
```
🚕 タクシープール現況・出庫                ▶使い方
┌──────────┐ ┌──────────┐
│ real01 写真 │ │ real02 写真 │   ←直近(数分前)
└──────────┘ └──────────┘
混み具合: ●●●●○ 混雑 (在台 約42台)
今日の流れ: 活発↑ (直近1h 出庫38台 / 平常28台)
──────────────────────────────
表示:[実績▼]   範囲:[直近2時間|今日全部]
（出庫実績テーブル：従来どおり）
…予測（目安・学習中）ⓘ
```

## 分割（テスト可能な単位）
- `taxi-ic-helper`：`pool-status` 純関数（occ→level 写像、活発さ判定、status ビルダー）＋サムネ生成（I/O）。
- `daily-report`：`pool-status-section.js`（fetch＋描画。描画ヘルパは純関数化してテスト）。

## テスト
- 純関数の単体テスト：level 写像（境界値）、活発さ（↑/→/↓・平常0除算ガード）、status ビルダー、STALE 判定。
- サムネ生成：スモーク（ファイル生成・サイズ上限）。
- UI：dev で手動（写真表示・レベル・矢印・STALE・実績据置・予測ラベル）。

## デプロイ
- taxi-ic-helper：feat ブランチ→（承認）→ origin/main。Mac mini 自動pullで配信開始。relay 更新。
- 日報：worktree → `dpush.sh`（dev）→ dev確認 → 本番タグ（tagpush）。SW CACHE_NAME bump 済のため
  リリース後 **PWA 再起動**（アプリを閉じて開き直し）を案内する。

## リスク・留意
- **サムネを5分毎に git コミット＝肥大**。同名上書き・小サイズで緩和。長期的に重ければ
  cadence を下げる/別配信に切替（将来）。
- `fullRef`・平常は数日の fill 履歴前提（現在6日）。履歴が浅い間はレベルが粗い→自己較正で改善。
- 予測は低精度のまま（「目安」明示で運用。将来 fill 統一 `feat/forecast-on-fill` で改善）。

## 非対象（YAGNI）
- 予測ロジックの改善・fill 統一切替（別タスク）。
- 過去画像の再生成・複数日バックフィル。
- 通知・アラート。

# 設計: 初回入力導線（オンボーディング #2）

- 日付: 2026-05-22
- 対象: 新規ドライバー（特に提携組合・恵豊／高齢層を含む）
- 関連: `.company/qa/reports/2026-05-22-onboarding-gap-audit.md`（ギャップ#2）

## 背景・課題

申込完了後の導線が閉じていない。`subscribe-success.html` は「ホームへ進む」のみ、
`index.html` の空状態は「乗務を入力すると…」と表示するだけで、**最初の日報をどこから
入力するか**が新規ドライバーに伝わらない（FABは非表示、入力はボトムナビ頼み）。
結果、申込直後に「次に何を」で止まり、最初の成功体験に届かない。

## ゴール

新規ドライバーが申込直後に迷わず最初の日報入力にたどり着く。
写真がある人はその場でアップ、無い人は「次の乗務で明細の写真を撮る」と分かる。

## スコープ外（今回やらない）

- 使い方動画（別セッションで進行中・完成後に本番反映）
- IC判定／需要予測のUI内ヘルプ（稼働セッション `ic-judge-ui-redesign` と衝突するため後日）
- 会社設定の正確値反映（明日の組合長から入手後・別タスク）

## 設計（案A: 空状態を行動カード化＋申込完了にボタン）

### 1. ホーム「初回行動カード」`firstRunCard`（index.html）
- `<main>` 上部（既存バナー群の近く・summaryCard より前）に新カードを追加。既定 `display:none`。
- **表示条件**: そのユーザーに日報が1件も無い時のみ。1件でも入ると自動で消える。
  - ×ボタン（閉じる）は付けない＝localStorage 既読方式の「一度閉じると二度と出ない」問題を構造的に回避。
- 内容（コピー確定）:
  - 見出し: 「最初の日報を入れてみましょう」
  - 本文: 「営業明細（日報）の写真があれば、ボタンから選ぶだけで自動入力できます。」
  - 主ボタン: 「📷 明細の写真から入力」→ `input.html`
  - 補足: 「まだ写真が無い方は、次の乗務のあとに明細の写真を撮っておきましょう。」

### 2. 申込完了（subscribe-success.html）
- 主ボタン「📷 さっそく最初の日報を入れる」→ `input.html` を追加。
- 既存「ホームへ進む」→ `index.html` は副ボタン（控えめスタイル）に降格。

### 3. 判定ロジック（テスト可能な純関数）
- 新規 `js/first-run.js`:
  ```js
  // 日報が1件も無い新規ユーザーにのみ初回カードを出す
  export function shouldShowFirstRunCard({ hasAnyDrive }) {
    return hasAnyDrive === false;
  }
  ```
- `hasAnyDrive` の決定（index.html 側）:
  1. localStorage marker `cabis_has_drive === '1'` があれば `true`（即確定・追加fetch無し）。
  2. 無ければ当期の drives をチェック。`length > 0` なら `true` ＋ marker を `'1'` にセット。
  3. それでも 0 なら前期(1つ前の請求期)も確認。`length > 0` なら `true` ＋ marker セット。
  4. 当期・前期とも 0 かつ marker 無し → `false`（＝カード表示）。
- 初回保存時にも marker をセット（最初の日報保存後はカードを出さない）。保存箇所は実装計画で特定（detail/input の保存フロー）。
- トレードオフ: 「当期・前期とも0かつ過去にデータがある（3ヶ月以上未入力）既存ユーザー」には誤表示しうるが、稀。新規ユーザーには常に正しく表示。

## エラー/エッジ
- subscription 状態が未申込/pending のユーザーには既存 `onboardBanner`（申込導線）が優先。firstRunCard は「申込済みだが日報0件」のユーザーに効く（両者は併存しても害がない＝申込導線＋入力導線）。
- drives 取得失敗時は firstRunCard を出さない（既存ホームの挙動を壊さない）。

## テスト
- 単体（jest 既存スイート）: `tests/first-run.test.js`
  - `shouldShowFirstRunCard({hasAnyDrive:false}) === true`
  - `shouldShowFirstRunCard({hasAnyDrive:true}) === false`
- スモーク（ヘッドレス）: index を drives 0件で描画→ firstRunCard 可視 ／ drives 有りまたは marker 有り→ 非表示。

## 変更ファイル
- `index.html`（firstRunCard マークアップ＋表示制御）
- `subscribe-success.html`（入力ボタン追加・既存ボタン降格）
- `js/first-run.js`（新・純関数）
- `tests/first-run.test.js`（新）
- `sw.js`（STATIC_FILES に `js/first-run.js` 追加＋ CACHE_NAME bump）

## デプロイ
- dev/main 基点（クローン `~/work/taxi-dev`・branch `feat/onboarding-first-input`）。
- TDD 実装 → dev 反映（push dev:main）→ 本人が dev 実機で確認 → 承認後に本番（`v*` タグ）。
- 本番反映後は PWA 再起動を案内（sw.js bump のため）。

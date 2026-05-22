# 使い方動画オンボーディング（インライン展開）設計

- 日付: 2026-05-22
- ブランチ: `feat/help-video-onboarding`（dev/main 基点）
- レイヤー: Micro（製品実装）

## 1. 目的

新規ユーザーが「実際の操作画面」を見て使い方を理解できるようにする。各機能の近くに「▶ 使い方」ボタンを置き、**ページ遷移せず・その場で**短い操作動画を再生する。文字説明より「触って見る」方が分かりやすい、という要望に応える。

## 2. 非機能要件（必須）

- **全ページの初期表示は3秒以内を維持する。** 動画追加によってページの開く速さを一切悪化させない。
  - 担保策: 動画・サムネはページHTMLに最初から置かず、DOMへ遅延注入する。「▶」タップでポスター注入、ポスター(再生)タップで初めて `<video>` を生成する2段階。**遅延の保証は「DOM注入のタイミング」で行う**（ページに `<video>` が存在しないので読み込みようがない）。再生時に生成する `<video>` は即時再生のため `autoplay`＋`preload="auto"` とする（この要素は再生タップ後にしか存在しないので3秒ルールに影響しない）。ページ表示時に増えるのはボタン文言・小さなJS（合計約5KB、SWキャッシュ配信）のみ＝動画/サムネは0バイト。
  - 検証: 機能追加前後で対象ページ（input.html / ocr-import.html）の初期表示時間を計測し、3秒以内かつ悪化なしを確認する。
- オフライン再生は対象外（オンライン時のみ再生できればよい）。

## 3. スコープ

### MVP（本チケット）
| 画面 | help key | 動画の内容 |
|---|---|---|
| `input.html`（日報入力） | `input-paste` | 日報テキストを貼って取り込む流れ |
| `ocr-import.html`（写真OCR取込） | `ocr-import` | 写真を撮って明細を取り込む流れ |

### 非スコープ（将来）
- 上記以外の画面への横展開（仕組みは流用可能にしておく）
- 初回起動時のフルスクリーン・ツアー
- guide.html への動画集約

## 4. UI仕様（インライン展開・案B）

- 既存の文字ヘルプ `?`（`js/help-toggle.js`）と並列で、「▶ 使い方（NN秒）」ボタンを各機能ラベル付近に置く。
- タップすると、**ボタン直下に動画ブロックがスライド展開**（`max-height` トランジション）。同画面のまま、ページ遷移なし。
- 再生前は**ポスター＋中央の再生アイコン**を表示（押すまで動画は読み込まない＝3秒ルール担保）。ポスターをタップで再生開始。
- 動画下に1行キャプション、「折りたたむ」ボタンで閉じる。再度ボタンを押すとトグルで閉じる。
- 動画は縦向き、列幅に収まるサイズ。`playsinline`・`muted`・`controls`・`autoplay`・`preload="auto"`（再生タップ後にのみ生成される要素なので即時再生優先）。
- 実装は `help-toggle.js` と同じ **イベント委譲方式**（後から差し替わるDOMでも動作）。

### トリガーHTML例
```html
<button class="help-video-btn" data-help-video="ocr-import">▶ 使い方（15秒）</button>
<div class="help-video" id="help-video-ocr-import"></div>  <!-- 展開先（中身は遅延注入） -->
```

## 5. 配信・キャッシュ設計（軽量の肝）

- 動画ファイルは同一オリジンの `media/help/` に置く（リポジトリ管理 → deploy.yml の rsync で配信される）。
- **Service Worker の `STATIC_FILES` には動画・サムネを追加しない**（install を太らせない＝起動は今まで通り軽い）。
- **SW は動画（`.mp4` 等）をキャッシュ素通し**にする。理由: `<video>` は range リクエスト（途中再生・シーク）を行い、iOS Safari でキャッシュ経由にすると再生/シークが壊れやすい。オフライン非対応なので素通しで問題ない。
  - `sw.js` の fetch ハンドラに「動画(`.mp4`等)は早期 return（素通し）」ルールを追加。さらに**サムネ含む `media/help/` 配下全体も素通し**（差し替え時の陳腐化防止・help媒体はキャッシュしない設計に統一）。
- 新規JS（`help-video.js` / `help-video-registry.js`）は `STATIC_FILES` に追加し、**CACHE_NAME を bump**（dev/main基点の現状 v182→v183。※他worktreeも別番号でbump中のため、dev反映/マージ時は dev の現行番号+1 に再調整すること）。

## 6. 動画ファイル仕様

- 形式: MP4 (H.264 / yuv420p)、無音、`+faststart`（先頭から即再生）。
- 長さ: 10〜20秒。1本あたり目標 数百KB〜1MB。
- 向き: 縦（実機録画準拠）。
- サムネ: 各動画に1枚（jpg、軽量）。`media/help/<key>.jpg`。

## 7. データ構造（登録表）

`js/help-video-registry.js` に key → メタ情報のマップを持つ。動画追加は録画→圧縮→ファイル配置→ここに1行追記で完結。

```js
export const HELP_VIDEOS = {
  'input-paste': { src: 'media/help/input-paste.mp4', poster: 'media/help/input-paste.jpg', caption: '日報を貼って取り込む手順', durationSec: 15 },
  'ocr-import':  { src: 'media/help/ocr-import.mp4',  poster: 'media/help/ocr-import.jpg',  caption: '写真を撮って取り込む手順', durationSec: 15 },
};
```

## 8. 変更/新規ファイル

新規:
- `js/help-video.js` — トリガー委譲・遅延注入・展開/折りたたみ・再生制御
- `js/help-video-registry.js` — 動画登録表
- `media/help/` — MP4＋サムネ（MVPで2本）
- `scripts/compress-help-video.sh` — 実機録画(.mov)→無音・短尺・小さいMP4＋サムネ生成（ffmpeg）

変更:
- `css/style.css` — `.help-video-btn` / `.help-video`（展開アニメ）スタイル追記
- `input.html` — 「▶ 使い方」ボタン＋展開先＋`help-video.js` import
- `ocr-import.html` — 同上
- `sw.js` — 動画素通しルール追加 / 新規JS2本を `STATIC_FILES` 追加 / CACHE_NAME bump

## 9. 動画制作パイプライン（本人の作業を最小化）

1. iPhone の画面収録で操作を撮る（.mov）。
2. `scripts/compress-help-video.sh input.mov media/help/<key>.mp4` を実行 → 無音・縮小・圧縮MP4＋サムネ自動生成。
3. `help-video-registry.js` に1行追記。

→ 「録る・通す・1行」で1機能ぶん完成。

## 10. 受け入れ基準 / テスト

- [ ] 機能追加後も input.html / ocr-import.html の初期表示が3秒以内（追加前後で計測し悪化なし）。
- [ ] ページを開いた時点で動画/サムネへのネットワークリクエストが発生しない（DevTools/ヘッドレスで確認）。
- [ ] 「▶」タップで直下に展開、ポスター表示。ポスタータップで再生。「折りたたむ」/再タップで閉じる。
- [ ] 開閉ロジックの単体テスト（委譲・トグル・複数動画の独立開閉）。
- [ ] ヘッドレス・スモークで両ページが描画・操作できる（課金ゲート対象なら seed 手順を使用）。

## 11. デプロイ

- 実装は本worktree（`feat/help-video-onboarding`）。
- dev反映: `git push dev HEAD:main` → dev確認URLで本人が**実機（iPhone原本録画）**で確認。
- 本番: 承認後 `v*` タグ。SW CACHE_NAME を bump しているので、リリース後は**PWA再起動**を案内する。
- `media/` は rsync 同期対象（prod-only 手動ファイルではないので消えない）。

## 12. リスク / 留意点

- iOS Safari の range リクエスト → SW 素通しで回避（§5）。
- iCloud が `.git` に重複 ref を作る既知問題 → fetch/push 失敗時は `find .git -name "* [0-9]" -delete`。
- deploy.yml は rsync `--delete` 同期 → `media/help/` は dev/本番どちらにも入るので問題なし。
- 実機検証はチャット画像（縮小・回転される）ではなく iPhone 原本で行う。

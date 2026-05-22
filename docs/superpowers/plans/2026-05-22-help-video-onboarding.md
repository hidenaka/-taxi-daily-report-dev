# 使い方動画オンボーディング（インライン展開）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各画面の「▶ 使い方」ボタンで、ページ遷移せず・その場でインライン展開して短い操作動画を再生する。MVPは日報入力(input.html)と写真OCR取込(ocr-import.html)の2本。

**Architecture:** 既存の `help-toggle.js`（?文字ヘルプの開閉）と同じイベント委譲方式を踏襲。ページHTMLには空の展開コンテナと「▶」ボタンだけを置き、動画・サムネは**タップ時にDOMへ遅延注入**する（ページを開いた時点で動画/サムネは0バイト＝全ページ3秒以内表示を死守）。動画は `media/help/` に置き、Service Worker は動画を素通し（iOSのrange/シーク不具合回避・オフライン非対応）。

**Tech Stack:** Vanilla ES Modules（バンドラなし）、`node --test` によるテスト（`tests/run.js` が `test`/`assert` を提供）、Service Worker キャッシュ、ffmpeg（動画圧縮スクリプト）。

**前提:** worktree `タクシー日報-wt-help-video/`（ブランチ `feat/help-video-onboarding`、dev/main 基点）で作業する。仕様書: `docs/superpowers/specs/2026-05-22-help-video-onboarding-design.md`。

---

## File Structure

新規:
- `js/help-video-registry.js` — 動画の登録表（key → {src, poster, caption}）。データのみ。
- `js/help-video.js` — 純関数（getVideoEntry / buildPlayerHTML / buildVideoTag）＋ DOM委譲ワイヤリング。
- `tests/help-video-registry.test.js` — 登録表の構造検証。
- `tests/help-video.test.js` — 純関数の検証。
- `tests/help-video-pages.test.js` — 「3秒ルール」静的ガード（HTMLに動画/サムネが直書きされていないことを保証）。
- `scripts/compress-help-video.sh` — 実機録画(.mov)→軽量MP4＋サムネ生成（ffmpeg）。
- `media/help/input-paste.mp4` / `.jpg`、`media/help/ocr-import.mp4` / `.jpg` — 当面は差し替え用プレースホルダ。

変更:
- `css/style.css` — `.help-video-btn` / `.help-video` ほかスタイル追記。
- `input.html` — text-paste 近くに「▶」ボタン＋空コンテナ、`help-video.js` import。
- `ocr-import.html` — overview 近くに「▶」ボタン＋空コンテナ、`help-video.js` モジュール読込。
- `sw.js` — CACHE_NAME bump(v179→v180)、新JS2本を STATIC_FILES 追加、動画素通しルール追加。

---

## Task 1: 動画登録表モジュール

**Files:**
- Create: `js/help-video-registry.js`
- Test: `tests/help-video-registry.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/help-video-registry.test.js`:
```js
import { test, assert } from './run.js';
import { HELP_VIDEOS } from '../js/help-video-registry.js';

test('HELP_VIDEOS に MVP の2キーが存在する', () => {
  assert.ok(HELP_VIDEOS['input-paste'], 'input-paste が必要');
  assert.ok(HELP_VIDEOS['ocr-import'], 'ocr-import が必要');
});

test('各エントリは src/poster/caption を持ち、media/help/ 配下を指す', () => {
  for (const [key, e] of Object.entries(HELP_VIDEOS)) {
    assert.ok(e.src.startsWith('media/help/'), `${key}.src は media/help/ 配下`);
    assert.ok(e.src.endsWith('.mp4'), `${key}.src は .mp4`);
    assert.ok(e.poster.startsWith('media/help/'), `${key}.poster は media/help/ 配下`);
    assert.ok(typeof e.caption === 'string' && e.caption.length > 0, `${key}.caption は非空`);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/help-video-registry.test.js`
Expected: FAIL（`Cannot find module ../js/help-video-registry.js`）

- [ ] **Step 3: 登録表を実装**

`js/help-video-registry.js`:
```js
// 使い方動画の登録表。動画追加はここに1行足すだけ。
// src/poster はページ(ルート直下のhtml)からの相対パス。
export const HELP_VIDEOS = {
  'input-paste': {
    src: 'media/help/input-paste.mp4',
    poster: 'media/help/input-paste.jpg',
    caption: '日報を貼って取り込む手順',
  },
  'ocr-import': {
    src: 'media/help/ocr-import.mp4',
    poster: 'media/help/ocr-import.jpg',
    caption: '写真を撮って取り込む手順',
  },
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/help-video-registry.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add js/help-video-registry.js tests/help-video-registry.test.js
git commit -m "feat(help-video): 使い方動画の登録表モジュール

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: help-video.js 純関数 ＋ DOMワイヤリング

**Files:**
- Create: `js/help-video.js`
- Test: `tests/help-video.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/help-video.test.js`:
```js
import { test, assert } from './run.js';
import { getVideoEntry, buildPlayerHTML, buildVideoTag } from '../js/help-video.js';

const REG = {
  'input-paste': { src: 'media/help/input-paste.mp4', poster: 'media/help/input-paste.jpg', caption: '貼って取り込む' },
};

test('getVideoEntry: 存在キーでエントリを返す', () => {
  assert.equal(getVideoEntry('input-paste', REG).src, 'media/help/input-paste.mp4');
});

test('getVideoEntry: 未知キーで null', () => {
  assert.equal(getVideoEntry('nope', REG), null);
});

test('buildPlayerHTML: poster と caption を含み、video要素は含まない（遅延の保証）', () => {
  const html = buildPlayerHTML(REG['input-paste']);
  assert.ok(html.includes('media/help/input-paste.jpg'), 'poster を含む');
  assert.ok(html.includes('貼って取り込む'), 'caption を含む');
  assert.ok(html.includes('hv-play'), '再生ボタンを含む');
  assert.ok(!html.includes('<video'), 'この段階では video 要素を作らない');
});

test('buildVideoTag: src付きの video を返す（autoplay/muted/playsinline）', () => {
  const tag = buildVideoTag(REG['input-paste']);
  assert.ok(tag.includes('<video'), 'video 要素');
  assert.ok(tag.includes('src="media/help/input-paste.mp4"'), 'src');
  assert.ok(tag.includes('autoplay'), 'autoplay');
  assert.ok(tag.includes('muted'), 'muted');
  assert.ok(tag.includes('playsinline'), 'playsinline');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/help-video.test.js`
Expected: FAIL（`Cannot find module ../js/help-video.js`）

- [ ] **Step 3: 実装する**

`js/help-video.js`:
```js
// 使い方動画のインライン展開プレイヤー。
// 既存 help-toggle.js と同じイベント委譲方式。
// ページ読込時は「▶ボタン + 空コンテナ」だけが存在し、動画/サムネは0バイト。
// ▶タップ → コンテナ展開＋ポスター注入（サムネ読込）。
// ▶(再生)タップ → video 要素を生成して再生（動画ダウンロード開始）。
// 使い方:
//   <button class="help-video-btn" data-help-video="KEY">▶ 使い方（15秒）</button>
//   <div class="help-video" id="help-video-KEY"></div>
import { HELP_VIDEOS } from './help-video-registry.js';

export function getVideoEntry(key, registry = HELP_VIDEOS) {
  return (key && registry[key]) ? registry[key] : null;
}

export function buildPlayerHTML(entry) {
  return (
    '<div class="hv-player">' +
      '<img class="hv-poster" src="' + entry.poster + '" alt="" ' +
        'onerror="this.closest(\'.hv-player\').classList.add(\'hv-error\')">' +
      '<button class="hv-play" type="button" aria-label="再生">▶</button>' +
      '<div class="hv-fallback">動画は準備中です</div>' +
    '</div>' +
    '<p class="hv-cap">' + entry.caption + '</p>' +
    '<button class="hv-close" type="button">折りたたむ</button>'
  );
}

export function buildVideoTag(entry) {
  return (
    '<video class="hv-video" src="' + entry.src + '" poster="' + entry.poster + '" ' +
    'controls autoplay muted playsinline preload="auto"></video>' +
    '<p class="hv-cap">' + entry.caption + '</p>' +
    '<button class="hv-close" type="button">折りたたむ</button>'
  );
}

function keyOf(container) {
  return container.id.replace(/^help-video-/, '');
}

function triggerFor(key) {
  return document.querySelector('.help-video-btn[data-help-video="' + key + '"]');
}

function toggle(key) {
  const container = document.getElementById('help-video-' + key);
  if (!container) return;
  const entry = getVideoEntry(key);
  if (!entry) return;
  const willOpen = !container.classList.contains('open');
  const btn = triggerFor(key);
  if (willOpen) {
    if (!container.innerHTML.trim()) container.innerHTML = buildPlayerHTML(entry);
    container.classList.add('open');
    if (btn) btn.classList.add('open');
  } else {
    closeVideo(container);
  }
}

function startVideo(container) {
  if (!container) return;
  const entry = getVideoEntry(keyOf(container));
  if (!entry) return;
  container.innerHTML = buildVideoTag(entry); // ここで初めて動画をダウンロード
}

function closeVideo(container) {
  if (!container) return;
  container.classList.remove('open');
  container.innerHTML = ''; // video を破棄＝再生停止・メモリ解放
  const btn = triggerFor(keyOf(container));
  if (btn) btn.classList.remove('open');
}

// DOM 委譲（node テスト環境では document 不在なのでスキップ）
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.help-video-btn');
    if (trigger) { toggle(trigger.getAttribute('data-help-video')); return; }
    const play = e.target.closest('.hv-play');
    if (play) { startVideo(play.closest('.help-video')); return; }
    const close = e.target.closest('.hv-close');
    if (close) { closeVideo(close.closest('.help-video')); return; }
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/help-video.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add js/help-video.js tests/help-video.test.js
git commit -m "feat(help-video): インライン展開プレイヤー（遅延注入・委譲）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CSS（ボタン・展開・プレイヤー）

**Files:**
- Modify: `css/style.css`（末尾に追記。既存 `.help-content`（197行付近）の直後でも可）

- [ ] **Step 1: スタイルを追記**

`css/style.css` の末尾に追記:
```css
/* === 使い方動画（インライン展開） === */
.help-video-btn {
  display: inline-flex; align-items: center; gap: 5px; margin-left: 6px;
  background: #e8f1fb; color: var(--primary); border: 1px solid #cfe2f7;
  border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700;
  font-family: inherit; cursor: pointer; vertical-align: middle;
}
.help-video-btn:hover, .help-video-btn:focus { opacity: 0.85; outline: none; }
.help-video { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.help-video.open { max-height: 640px; margin: 8px 0; }
.hv-player {
  position: relative; width: 100%; max-width: 230px; margin: 0 auto;
  aspect-ratio: 9 / 16; background: #11151a; border-radius: 12px; overflow: hidden;
}
.hv-poster { width: 100%; height: 100%; object-fit: cover; display: block; }
.hv-play {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,0.95);
  color: var(--primary); border: none; font-size: 18px; padding-left: 3px; cursor: pointer;
}
.hv-fallback {
  display: none; position: absolute; inset: 0; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; text-align: center; padding: 12px;
}
.hv-player.hv-error .hv-poster, .hv-player.hv-error .hv-play { display: none; }
.hv-player.hv-error .hv-fallback { display: flex; }
.hv-video {
  width: 100%; max-width: 230px; margin: 0 auto; display: block;
  border-radius: 12px; background: #000; aspect-ratio: 9 / 16; object-fit: contain;
}
.hv-cap { font-size: 11px; color: var(--muted); text-align: center; margin: 8px 0 0; }
.hv-close {
  display: block; width: 100%; margin-top: 10px; padding: 9px;
  background: #e8f1fb; color: var(--primary); border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
}
```

- [ ] **Step 2: コミット**

```bash
git add css/style.css
git commit -m "feat(help-video): インライン展開プレイヤーのスタイル

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: input.html にボタン＋コンテナ＋import を配線

**Files:**
- Modify: `input.html`（81行付近の text-paste ラベル / 163行付近の import）

- [ ] **Step 1: text-paste ラベルに「▶」ボタンを追加し、help-content の直後に空コンテナを置く**

`input.html` の以下の行（81行付近）:
```html
    <label class="muted">日報テキストを貼付（Claude/Gemini/フォーマット済み 自動判別）<button class="help-btn" data-help-for="text-paste" aria-label="ヘルプ">?</button></label>
```
を次に置換（`▶ 使い方` ボタンを追加）:
```html
    <label class="muted">日報テキストを貼付（Claude/Gemini/フォーマット済み 自動判別）<button class="help-btn" data-help-for="text-paste" aria-label="ヘルプ">?</button><button class="help-video-btn" data-help-video="input-paste" type="button">▶ 使い方（15秒）</button></label>
```

そして、その直後にある `</div>`（help-content `#help-text-paste` の閉じ。88行付近）の**次の行**に空コンテナを追加:
```html
    </div>
    <div class="help-video" id="help-video-input-paste"></div>
```

- [ ] **Step 2: 既存のモジュール script に help-video.js を import**

`input.html` 163行付近:
```js
import './js/help-toggle.js';
```
の直後に追加:
```js
import './js/help-video.js';
```

- [ ] **Step 3: 構文確認（HTMLの体裁）**

Run: `node -e "const s=require('fs').readFileSync('input.html','utf8'); if(!s.includes('data-help-video=\"input-paste\"'))throw new Error('btn欠落'); if(!s.includes('id=\"help-video-input-paste\"'))throw new Error('container欠落'); if(!s.includes(\"import './js/help-video.js'\"))throw new Error('import欠落'); console.log('OK');"`
Expected: `OK`

- [ ] **Step 4: コミット**

```bash
git add input.html
git commit -m "feat(help-video): input.html に使い方動画ボタンを設置

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ocr-import.html にボタン＋コンテナ＋読込を配線

**Files:**
- Modify: `ocr-import.html`（27行付近の h1 / 68-69行付近の script）

- [ ] **Step 1: h1 に「▶」ボタンを追加**

`ocr-import.html` 27行:
```html
    <h1 style="margin:0;flex:1;">写真から取り込み <button class="help-btn" data-help-for="ocr-overview" aria-label="ヘルプ">?</button></h1>
```
を次に置換:
```html
    <h1 style="margin:0;flex:1;">写真から取り込み <button class="help-btn" data-help-for="ocr-overview" aria-label="ヘルプ">?</button><button class="help-video-btn" data-help-video="ocr-import" type="button">▶ 使い方（15秒）</button></h1>
```

- [ ] **Step 2: overview help-content の直後に空コンテナを追加**

`ocr-import.html` 40行 `</div>`（`#help-ocr-overview` の閉じ）の次の行に追加:
```html
  </div>
  <div class="help-video" id="help-video-ocr-import"></div>
```

- [ ] **Step 3: help-video.js のモジュール読込を追加**

`ocr-import.html` 69行:
```html
<script type="module" src="js/help-toggle.js"></script>
```
の直後に追加:
```html
<script type="module" src="js/help-video.js"></script>
```

- [ ] **Step 4: 構文確認**

Run: `node -e "const s=require('fs').readFileSync('ocr-import.html','utf8'); if(!s.includes('data-help-video=\"ocr-import\"'))throw new Error('btn欠落'); if(!s.includes('id=\"help-video-ocr-import\"'))throw new Error('container欠落'); if(!s.includes('src=\"js/help-video.js\"'))throw new Error('script欠落'); console.log('OK');"`
Expected: `OK`

- [ ] **Step 5: コミット**

```bash
git add ocr-import.html
git commit -m "feat(help-video): ocr-import.html に使い方動画ボタンを設置

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 「3秒ルール」静的ガードテスト

ページHTMLに動画/サムネが直書きされていない（=ページを開いた時に動画/サムネを読まない）ことを自動で保証する。

**Files:**
- Create: `tests/help-video-pages.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/help-video-pages.test.js`:
```js
import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';

const PAGES = {
  'input.html': 'input-paste',
  'ocr-import.html': 'ocr-import',
};

for (const [page, key] of Object.entries(PAGES)) {
  const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');

  test(`${page}: ▶ボタンと空の展開コンテナが存在する`, () => {
    assert.ok(html.includes('data-help-video="' + key + '"'), '▶ボタン');
    assert.ok(html.includes('id="help-video-' + key + '"'), '展開コンテナ');
  });

  test(`${page}: 動画/サムネがHTMLに直書きされていない（3秒ルール）`, () => {
    assert.ok(!/<video[\s>]/i.test(html), 'video要素を直書きしない');
    assert.ok(!html.includes('media/help/'), 'media/help/ をHTMLで参照しない（注入はJS側）');
  });
}
```

- [ ] **Step 2: テストが通ることを確認**（Task 4/5 実装済みのため最初から通る）

Run: `node --test tests/help-video-pages.test.js`
Expected: PASS（4 tests）。もし FAIL する場合は input.html/ocr-import.html に動画/サムネを直書きしている＝3秒ルール違反なので修正する。

- [ ] **Step 3: コミット**

```bash
git add tests/help-video-pages.test.js
git commit -m "test(help-video): ページに動画を直書きしない3秒ルール静的ガード

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Service Worker（bump・JS登録・動画素通し）

**Files:**
- Modify: `sw.js`
- Test: `tests/help-video-sw.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/help-video-sw.test.js`:
```js
import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('CACHE_NAME が v180 にbumpされている', () => {
  assert.ok(sw.includes("CACHE_PREFIX + 'v180'"), 'v180 へ bump');
});

test('新規JS2本が STATIC_FILES に登録されている', () => {
  assert.ok(sw.includes("'./js/help-video.js'"), 'help-video.js');
  assert.ok(sw.includes("'./js/help-video-registry.js'"), 'help-video-registry.js');
});

test('動画は素通し（キャッシュしない）ルールがある', () => {
  assert.ok(/\\.(mp4\|webm\|mov)\$/.test(sw) || sw.includes('mp4'), '動画拡張子の分岐');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/help-video-sw.test.js`
Expected: FAIL（v180 未設定 / JS未登録）

- [ ] **Step 3: sw.js を編集**

(a) CACHE_NAME を bump:
```js
const CACHE_NAME = CACHE_PREFIX + 'v179';
```
を
```js
const CACHE_NAME = CACHE_PREFIX + 'v180';
```

(b) STATIC_FILES に2本追加（`'./js/help-toggle.js',` の直後）:
```js
  './js/help-toggle.js',
  './js/help-video.js',
  './js/help-video-registry.js',
```

(c) 動画素通しルールを追加。fetch ハンドラ内の既存の素通し行:
```js
  if (url.pathname.includes('/migrate.html') || url.pathname.includes('/admin.html')) return;
```
の直後に追加:
```js
  // 使い方動画は素通し（キャッシュしない）。<video> の range/シークを壊さないため・オフライン非対応。
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/help-video-sw.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add sw.js tests/help-video-sw.test.js
git commit -m "feat(help-video): SW v180 bump・新JS登録・動画素通し

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 動画圧縮スクリプト

実機の画面収録(.mov)を、無音・短尺・小さいMP4＋サムネに変換する。

**Files:**
- Create: `scripts/compress-help-video.sh`

- [ ] **Step 1: スクリプトを作成**

`scripts/compress-help-video.sh`:
```bash
#!/usr/bin/env bash
# 使い方動画の圧縮ツール。
# 例: scripts/compress-help-video.sh ~/Downloads/rec.mov media/help/ocr-import.mp4
# 出力: 無音・縦・H.264 のMP4 と、同名 .jpg のサムネ。
set -euo pipefail

IN="${1:?usage: compress-help-video.sh <input.mov> <media/help/<key>.mp4>}"
OUT="${2:?usage: compress-help-video.sh <input.mov> <media/help/<key>.mp4>}"
POSTER="${OUT%.mp4}.jpg"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg が必要です（brew install ffmpeg）" >&2
  exit 1
fi

# 横幅を最大480pxへ縮小（縦は自動・偶数化）。無音。faststartで先頭から即再生。
ffmpeg -y -i "$IN" -an \
  -vf "scale='min(480,iw)':-2" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 28 -preset slow \
  -movflags +faststart "$OUT"

# サムネ（0.5秒地点の1フレーム）
ffmpeg -y -ss 0.5 -i "$IN" -frames:v 1 -vf "scale='min(480,iw)':-2" -q:v 4 "$POSTER"

echo "done:"
echo "  video : $OUT ($(du -h "$OUT" | cut -f1))"
echo "  poster: $POSTER ($(du -h "$POSTER" | cut -f1))"
echo "目標: 動画は数百KB〜1MB。超える場合は -crf を 30〜32 に上げて再実行。"
```

- [ ] **Step 2: 実行権限を付与**

Run: `chmod +x scripts/compress-help-video.sh && echo OK`
Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add scripts/compress-help-video.sh
git commit -m "feat(help-video): 実機録画を軽量MP4+サムネに変換するスクリプト

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 差し替え用プレースホルダ動画を配置

実際の操作動画は本人がiPhoneで録画する。それまで仕組みを実機で確認できるよう、軽量なプレースホルダを置く。

**Files:**
- Create: `media/help/input-paste.mp4` / `.jpg`、`media/help/ocr-import.mp4` / `.jpg`

- [ ] **Step 1: ディレクトリ作成**

Run: `mkdir -p media/help && echo OK`
Expected: `OK`

- [ ] **Step 2: プレースホルダ生成（ffmpeg）**

Run:
```bash
ffmpeg -y -f lavfi -i "color=c=0x0066cc:s=270x480:d=10:r=24" -an -c:v libx264 -pix_fmt yuv420p -crf 30 -movflags +faststart media/help/input-paste.mp4
ffmpeg -y -f lavfi -i "color=c=0x2e7d32:s=270x480:d=10:r=24" -an -c:v libx264 -pix_fmt yuv420p -crf 30 -movflags +faststart media/help/ocr-import.mp4
ffmpeg -y -f lavfi -i "color=c=0x0066cc:s=270x480" -frames:v 1 media/help/input-paste.jpg
ffmpeg -y -f lavfi -i "color=c=0x2e7d32:s=270x480" -frames:v 1 media/help/ocr-import.jpg
ls -lh media/help/
```
Expected: 4ファイルが生成され、各MP4は数十KB程度。

- [ ] **Step 3: コミット**

```bash
git add media/help/
git commit -m "chore(help-video): 差し替え用プレースホルダ動画を配置

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 全テスト＆ヘッドレス検証（3秒ルールの実測含む）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト実行**

Run: `node --test tests/*.test.js`
Expected: 既存テスト＋新規テスト（registry 2 / help-video 5 / pages 4 / sw 3）が全て PASS。失敗があれば該当タスクへ戻る。

- [ ] **Step 2: ヘッドレスで「ページを開いた時に動画/サムネを読まない」を実測**

`input.html` は `enforceAccess('core')` で課金ゲートあり。`reference_taxi-tool-page-smoke-test.md`（`localStorage taxi_user_id` + `sessionStorage taxi_sub_cache_v1` を seed）の手順でヘッドレス描画する。ローカルサーバ（`python3 -m http.server 8000`）を立て、Playwright で対象ページを開き、ネットワークログに `media/help/` へのリクエストが**0件**であることを確認する（▶を押すまで動画もサムネも飛ばない）。`ocr-import.html` も同様に確認。

- [ ] **Step 3: 表示速度の悪化なしを確認**

同ヘッドレス環境で input.html / ocr-import.html の DOMContentLoaded までの時間を計測し、3秒以内かつ実装前と差がない（≒数百ms）ことを確認する。SW由来の差異を避けるため計測は SW 未登録のクリーンコンテキストで行う。

- [ ] **Step 4: 確認結果を台帳に反映**

`.company/secretary/active-sessions.md` の `help-video-onboarding` 行 Status を「実装完了・dev反映待ち」に更新し、テスト件数・検証結果を追記する。

---

## デプロイ（実装完了後・本人主導）

1. dev反映: `git push dev HEAD:main`
2. 本人が dev確認URLで、**iPhone実機**から input.html / ocr-import.html を開き、▶展開→ポスター→再生→折りたたみ、各ページが素早く開くこと（3秒以内）を確認。
3. 本人が iPhone画面収録で実際の操作を録画 → `scripts/compress-help-video.sh` で変換 → `media/help/` のプレースホルダを差し替え → `help-video-registry.js` のキャプションを必要に応じて調整 → 再度dev確認。
4. 本番: 承認後 `v*` タグ。SW を v180 へ bump済みのため、**リリース後はPWA再起動を案内**する。

---

## Self-Review（記入済み）

- **Spec coverage**: §2 3秒ルール→Task6(静的ガード)+Task10(実測)。§4 インラインUI→Task2/3/4/5。§5 配信/SW素通し/bump→Task7。§6 動画仕様→Task8(スクリプト)。§7 登録表→Task1。§8 ファイル一覧→全タスクで網羅。§9 制作パイプライン→Task8。§10 受け入れ基準→Task6/Task10。§11 デプロイ→末尾。プレースホルダ(spec未記載の補助)→Task9で実機検証可能に。
- **Placeholder scan**: TBD/TODO等なし。全コードステップに実コードあり。
- **Type consistency**: `getVideoEntry`/`buildPlayerHTML`/`buildVideoTag`、クラス名 `help-video-btn`/`help-video`/`hv-player`/`hv-poster`/`hv-play`/`hv-fallback`/`hv-video`/`hv-cap`/`hv-close`、id `help-video-<key>`、data属性 `data-help-video` を全タスクで一貫使用。CACHE_NAME `v180` 一貫。

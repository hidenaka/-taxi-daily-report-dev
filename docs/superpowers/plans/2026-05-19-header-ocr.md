# 営業明細ヘッダーOCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 営業明細の写真から、表（trips/rests）に加えてヘッダー情報（処理日付・出庫日時・入庫日時・総走行距離）を読み取り、日報入力ページに自動反映する。

**Architecture:** 既存の表OCRパイプライン（preprocess→PP-OCRv5→template-reconstruct、97-98%実証済）には一切手を加えない。ヘッダー用に独立した経路を追加する ── 生画像を「クリップしない90度回転」で正立させ、上部22%帯を幅4500pxへ拡大してPP-OCRv5に通し、ラベル位置を基準に値を抽出する。Cloud Functionの戻り値を `{trips, rests, header}` に拡張し、`input.html` がheaderを各入力欄へ反映する。

**Tech Stack:** Node 22 / Firebase Cloud Functions 2nd gen / PP-OCRv5 (`ppu-paddle-ocr`) / `ppu-ocv` (canvas) / テストは Node 22 組み込み `node:test`。

---

## なぜこの設計か（背景）

- ヘッダーがこれまで読めなかった根本原因は、表用前処理 `preprocess.js` の回転処理がフォーム端の「処理日付ブロック」を画像外へクリップしていたこと。表は中央なので無事だった。
- 検証（2026-05-19）で、クリップしない正しいCW90度回転 → 上部帯を幅4500pxへ拡大 → `maxSideLength`を帯幅に上げてOCR、で**処理日付・出庫日時・入庫日時・走行KM・実車KM すべてが2000px原本でも鮮明に読めた**ことを確認済み。
- 表パイプラインを触らない理由: 97-98%の表OCR精度を絶対に壊さないため。ヘッダーは完全な別経路にする。

## File Structure

| ファイル | 役割 |
|---|---|
| `functions/src/header-ocr.js`（新規） | ヘッダーOCRの全責務。生画像Buffer → `extractHeader()` → `{date, departTime, returnTime, totalKm}`。回転・帯切り出し・拡大・OCR呼び出し・`parseHeaderBoxes()`（純粋関数）。 |
| `functions/src/header-ocr.test.js`（新規） | `parseHeaderBoxes()` の高速ユニットテスト（OCR実行なし）。 |
| `functions/src/header-ocr.integration.test.js`（新規） | 実画像 `ocr-spike/test-images/2026-05-10.png` を使う `extractHeader()` 統合テスト（OCR実行あり・低速）。 |
| `functions/src/ocr-engine.js`（変更） | ヘッダー用OCRサービス `getHeaderService()` を追加（`maxSideLength` を高く）。`MODELS` パスを共有。 |
| `functions/src/pipeline.js`（変更） | `ocrReport()` が `{trips, rests, header}` を返す。 |
| `functions/index.js`（変更） | レスポンスJSONに `header` を含める。 |
| `functions/package.json`（変更） | `test` スクリプトを追加。 |
| `js/ocr-import.js`（変更） | レスポンスの `header` を sessionStorage に乗せる。 |
| `input.html`（変更） | 出庫時刻欄・総走行距離欄を追加。`applyOcrImport()` で header を各欄へ反映。drive保存に `departureTime`（実値）と `totalDistanceKm` を含める。 |
| `sw.js`（変更） | `CACHE_NAME` を更新。 |

## ヘッダーオブジェクトの型（全層で統一）

```js
// header
{
  date: "2026-05-10" | null,   // 処理日付（ISO YYYY-MM-DD）
  departTime: "07:07" | null,  // 出庫日時の時刻部（HH:MM）
  returnTime: "00:39" | null,  // 入庫日時の時刻部（HH:MM）
  totalKm: 309 | null          // 走行KM（回送込み総走行距離・整数）
}
```

抽出に失敗した項目は `null`。`extractHeader` が例外を投げても全項目 `null` の header を返し、表OCRは絶対に止めない。

---

### Task 1: `parseHeaderBoxes()` — OCRボックス配列からヘッダー値を抽出する純粋関数

**Files:**
- Create: `functions/src/header-ocr.js`
- Create: `functions/src/header-ocr.test.js`
- Modify: `functions/package.json`

- [ ] **Step 1: package.json に test スクリプトを追加**

`functions/package.json` の `"main": "index.js",` の直後に `"scripts"` を追加する。変更後の全文:

```json
{
  "name": "taxi-ocr-functions",
  "description": "営業明細OCR用 Cloud Functions（端末内OCRをサーバー側へ移行）",
  "type": "module",
  "engines": {
    "node": "22"
  },
  "main": "index.js",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0",
    "onnxruntime-node": "^1.26.0",
    "ppu-ocv": "^3.1.5",
    "ppu-paddle-ocr": "^5.4.4"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/header-ocr.test.js` を新規作成:

```js
// functions/src/header-ocr.test.js
// parseHeaderBoxes（純粋関数）の高速ユニットテスト。OCRは実行しない。
import test from "node:test";
import assert from "node:assert/strict";
import { parseHeaderBoxes } from "./header-ocr.js";

// 2026-05-19の実OCR検証で得た実際のボックス座標（拡大後座標系）の関連抜粋。
// 走行KM(309) と 実車KM(170) を両方含め、混同しないことを確認する。
const realBoxes = [
  { text: "処理日付", bbox: [579, 259, 760, 290], confidence: 0.9 },
  { text: "2026/05/10", bbox: [536, 341, 720, 372], confidence: 0.9 },
  { text: "出庫日時", bbox: [2050, 213, 2230, 244], confidence: 0.9 },
  { text: "5/1007:07", bbox: [2022, 302, 2210, 333], confidence: 0.9 },
  { text: "入庫日時", bbox: [3100, 196, 3280, 227], confidence: 0.9 },
  { text: "5/1100:39", bbox: [3069, 283, 3260, 314], confidence: 0.9 },
  { text: "走行KM", bbox: [1554, 444, 1700, 475], confidence: 0.9 },
  { text: "实車KM", bbox: [1329, 449, 1470, 480], confidence: 0.9 },
  { text: "309", bbox: [1655, 512, 1720, 543], confidence: 0.9 },
  { text: "170", bbox: [1431, 518, 1496, 549], confidence: 0.9 },
];

test("実OCRボックスから4項目を抽出する", () => {
  const h = parseHeaderBoxes(realBoxes);
  assert.equal(h.date, "2026-05-10");
  assert.equal(h.departTime, "07:07");
  assert.equal(h.returnTime, "00:39");
  assert.equal(h.totalKm, 309);
});

test("走行KMと実車KMを混同しない（実車KM値を拾わない）", () => {
  const h = parseHeaderBoxes(realBoxes);
  assert.equal(h.totalKm, 309); // 170(実車KM) ではない
});

test("ボックスが空なら全項目 null", () => {
  const h = parseHeaderBoxes([]);
  assert.deepEqual(h, { date: null, departTime: null, returnTime: null, totalKm: null });
});

test("ラベルだけで値が無ければ該当項目は null", () => {
  const h = parseHeaderBoxes([
    { text: "処理日付", bbox: [579, 259, 760, 290], confidence: 0.9 },
    { text: "走行KM", bbox: [1554, 444, 1700, 475], confidence: 0.9 },
  ]);
  assert.equal(h.date, null);
  assert.equal(h.totalKm, null);
});

test("出庫日時が時刻のみ（日付なし）でも時刻を拾う", () => {
  const h = parseHeaderBoxes([
    { text: "出庫日時", bbox: [2050, 213, 2230, 244], confidence: 0.9 },
    { text: "07:07", bbox: [2022, 302, 2210, 333], confidence: 0.9 },
  ]);
  assert.equal(h.departTime, "07:07");
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd functions && npm test`
Expected: FAIL（`header-ocr.js` が存在しない / `parseHeaderBoxes` が未定義）

- [ ] **Step 4: `header-ocr.js` に `parseHeaderBoxes` を実装**

`functions/src/header-ocr.js` を新規作成（この時点では `parseHeaderBoxes` のみ。`extractHeader` は Task 2 で追加）:

```js
// functions/src/header-ocr.js
// 営業明細ヘッダー（処理日付・出庫日時・入庫日時・走行KM）の読み取り。
// 表OCRパイプラインとは独立。生画像を正立回転し、上部帯を拡大してOCRする。
// 画像・canvas はすべてメモリ上のみ。ディスクに保存しない。

// ラベルboxの近傍下方から値boxを1つ選ぶ。
// label の下方 y差 [minDy,maxDy]、x中心差 |dx| < maxDx の範囲で、
// pickValue(text) が非nullを返す最初の（最も近い）boxの結果を返す。
function valueBelow(boxes, label, { minDy, maxDy, maxDx }, pickValue) {
  const lx = (label.bbox[0] + label.bbox[2]) / 2;
  const ly = label.bbox[1];
  const cands = [];
  for (const b of boxes) {
    if (b === label) continue;
    const bx = (b.bbox[0] + b.bbox[2]) / 2;
    const dy = b.bbox[1] - ly;
    if (dy < minDy || dy > maxDy) continue;
    if (Math.abs(bx - lx) > maxDx) continue;
    const v = pickValue(b.text);
    if (v != null) cands.push({ v, dy });
  }
  cands.sort((a, b) => a.dy - b.dy);
  return cands.length ? cands[0].v : null;
}

// テキストから日付 YYYY/MM/DD を ISO YYYY-MM-DD に。
function pickDate(text) {
  const m = String(text).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// テキストから時刻 HH:MM を抽出（"5/1007:07" のような結合でも末尾の時刻を取る）。
function pickTime(text) {
  const all = String(text).match(/(\d{1,2}):(\d{2})/g);
  if (!all || !all.length) return null;
  const m = all[all.length - 1].match(/(\d{1,2}):(\d{2})/);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// テキストが純粋な整数なら数値に。
function pickInt(text) {
  const t = String(text).trim();
  if (!/^-?\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * ヘッダー帯のOCRボックス配列からヘッダー値を抽出する純粋関数。
 * @param {Array<{text:string,bbox:number[],confidence:number}>} boxes
 * @returns {{date:?string, departTime:?string, returnTime:?string, totalKm:?number}}
 */
export function parseHeaderBoxes(boxes) {
  const result = { date: null, departTime: null, returnTime: null, totalKm: null };
  if (!Array.isArray(boxes)) return result;

  const find = (pred) => boxes.find((b) => pred(String(b.text)));

  const dateLabel = find((t) => t.includes("処理") && t.includes("日付"));
  if (dateLabel) {
    result.date = valueBelow(boxes, dateLabel, { minDy: 30, maxDy: 160, maxDx: 250 }, pickDate);
  }

  const departLabel = find((t) => t.includes("出庫"));
  if (departLabel) {
    result.departTime = valueBelow(boxes, departLabel, { minDy: 30, maxDy: 160, maxDx: 300 }, pickTime);
  }

  const returnLabel = find((t) => t.includes("入庫"));
  if (returnLabel) {
    result.returnTime = valueBelow(boxes, returnLabel, { minDy: 30, maxDy: 160, maxDx: 300 }, pickTime);
  }

  // 走行KM: 「走行」かつ「KM/Km/ＫＭ」を含むラベル（「走行時間」「実車KM」を除外）。
  const kmLabel = find((t) => t.includes("走行") && /K[Mm]|ＫＭ/.test(t));
  if (kmLabel) {
    result.totalKm = valueBelow(boxes, kmLabel, { minDy: 30, maxDy: 160, maxDx: 230 }, pickInt);
  }

  return result;
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `cd functions && npm test`
Expected: PASS（`header-ocr.test.js` の5テストすべて。`integration.test.js` はまだ無い）

- [ ] **Step 6: コミット**

```bash
git add functions/src/header-ocr.js functions/src/header-ocr.test.js functions/package.json
git commit -m "feat: ヘッダーOCRのボックス抽出ロジック parseHeaderBoxes を追加"
```

---

### Task 2: `extractHeader()` — 画像からヘッダーをOCRで読み取る

**Files:**
- Modify: `functions/src/ocr-engine.js`
- Modify: `functions/src/header-ocr.js`
- Create: `functions/src/header-ocr.integration.test.js`

- [ ] **Step 1: `ocr-engine.js` にヘッダー用OCRサービスを追加**

`functions/src/ocr-engine.js` を変更する。`MODELS` 定義はそのまま。ファイル末尾（`recognizeBoxes` の後）に `getHeaderService` を追加し、既存の `getService` 内のモデル設定と重複する部分は共通化する。変更後の全文:

```js
// functions/src/ocr-engine.js
// PP-OCRv5（ppu-paddle-ocr・Node）のラッパ。検出・認識ともに基盤 PP-OCRv5。
// モデルは functions/models/ に同梱（コールドスタートで外部fetchしない）。
// 設定は ocr-spike/run-paddle-v5.mjs（97-98%実証済）と同一。
import { PaddleOcrService } from "ppu-paddle-ocr";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models");

// 全サービス共通のモデルファイル指定。
const MODEL_FILES = {
  detection: path.join(MODELS, "PP-OCRv5_mobile_det_infer.onnx"),
  recognition: path.join(MODELS, "PP-OCRv5_mobile_rec_infer.onnx"),
  charactersDictionary: path.join(MODELS, "ppocrv5_dict.txt"),
};

let service = null;
let headerService = null;

/**
 * 表OCR用サービスを初期化。関数インスタンス内で1回だけ。以降は再利用。
 */
export async function getService() {
  if (service) return service;
  const s = new PaddleOcrService({
    model: MODEL_FILES,
    processing: { engine: "canvas-native" },
    // 明細表の小さい数字を拾うため検出解像度を上げる（Phase 0/1A検証で確定）。
    detection: { maxSideLength: 1600, minimumAreaThreshold: 20 },
  });
  await s.initialize();
  service = s;
  return s;
}

/**
 * ヘッダーOCR用サービスを初期化。ヘッダー帯は幅4500pxへ拡大して渡すため、
 * 検出解像度をその幅まで上げる（小さく密なヘッダー文字を検出するため）。
 */
export async function getHeaderService() {
  if (headerService) return headerService;
  const s = new PaddleOcrService({
    model: MODEL_FILES,
    processing: { engine: "canvas-native" },
    detection: { maxSideLength: 4700, minimumAreaThreshold: 10 },
  });
  await s.initialize();
  headerService = s;
  return s;
}

/**
 * 前処理済み canvas をOCRし、検出ボックス配列を返す。
 * @param {object} canvas
 * @returns {Promise<Array<{text:string,bbox:number[],confidence:number}>>}
 */
export async function recognizeBoxes(canvas) {
  const svc = await getService();
  // per-box: 検出ボックスを1つずつ認識（密な表ではper-lineより適切）。
  const ocr = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  return (ocr.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
}

/**
 * ヘッダー帯 canvas をヘッダー用サービスでOCRし、検出ボックス配列を返す。
 * @param {object} canvas
 * @returns {Promise<Array<{text:string,bbox:number[],confidence:number}>>}
 */
export async function recognizeHeaderBoxes(canvas) {
  const svc = await getHeaderService();
  const ocr = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  return (ocr.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
}
```

- [ ] **Step 2: `header-ocr.js` に `extractHeader` を実装**

`functions/src/header-ocr.js` の先頭の import 行を追加し、ファイル末尾に `extractHeader` を追加する。ファイル先頭に追加する import:

```js
import { loadImage, createCanvas } from "ppu-ocv";
import { recognizeHeaderBoxes } from "./ocr-engine.js";
```

ファイル末尾（`parseHeaderBoxes` の後）に追加:

```js
// 生画像をフォームが正立する向きに整える。
// 営業明細は横長の紙に縦長レイアウト。横長写真は時計回り90度回転で正立する
// （2026-05-19検証でCW回転＝正立を確認）。縦長写真はそのまま使う。
function uprightCanvas(img) {
  if (img.width > img.height) {
    const c = createCanvas(img.height, img.width); // 幅=元高さ, 高さ=元幅
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    return c;
  }
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

const HEADER_BAND_RATIO = 0.22; // 正立画像の上部22%にヘッダー全体が収まる
const HEADER_TARGET_WIDTH = 4500; // 帯をこの幅へ拡大（検出が小さい文字を拾える）

/**
 * 生画像Bufferからヘッダー情報を読み取る。
 * 失敗しても例外を投げず、読めなかった項目は null で返す（表OCRを止めないため）。
 * @param {Buffer} imageBuffer 生画像（JPEG/PNG）
 * @returns {Promise<{date:?string, departTime:?string, returnTime:?string, totalKm:?number}>}
 */
export async function extractHeader(imageBuffer) {
  const empty = { date: null, departTime: null, returnTime: null, totalKm: null };
  try {
    const img = await loadImage(imageBuffer);
    const upright = uprightCanvas(img);
    const bandH = Math.round(upright.height * HEADER_BAND_RATIO);
    const scale = HEADER_TARGET_WIDTH / upright.width;
    const band = createCanvas(
      Math.round(upright.width * scale),
      Math.round(bandH * scale)
    );
    band
      .getContext("2d")
      .drawImage(upright, 0, 0, upright.width, bandH, 0, 0, band.width, band.height);
    const boxes = await recognizeHeaderBoxes(band);
    return parseHeaderBoxes(boxes);
  } catch (e) {
    console.warn("extractHeader: 失敗、ヘッダーは空で返す:", (e && e.message) || e);
    return empty;
  }
}
```

- [ ] **Step 3: 失敗する統合テストを書く**

`functions/src/header-ocr.integration.test.js` を新規作成:

```js
// functions/src/header-ocr.integration.test.js
// extractHeader の統合テスト。実画像でOCRを実行するため低速（数十秒）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHeader } from "./header-ocr.js";

const SAMPLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "ocr-spike", "test-images", "2026-05-10.png"
);

test("実画像 2026-05-10.png からヘッダー4項目を読み取る", { timeout: 180000 }, async () => {
  const buf = fs.readFileSync(SAMPLE);
  const h = await extractHeader(buf);
  assert.equal(h.date, "2026-05-10");
  assert.equal(h.departTime, "07:07");
  assert.equal(h.returnTime, "00:39");
  assert.equal(h.totalKm, 309);
});
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd functions && npm test`
Expected: PASS（`header-ocr.test.js` の5テスト + `header-ocr.integration.test.js` の1テスト。統合テストはOCR実行のため数十秒かかる）

もし統合テストの値がズレた場合は、`extractHeader` 内でデバッグ出力（`console.log(JSON.stringify(boxes))`）して座標を確認し、`parseHeaderBoxes` の `minDy/maxDy/maxDx` または `HEADER_BAND_RATIO` を調整する。調整後 Step 4 を再実行。

- [ ] **Step 5: コミット**

```bash
git add functions/src/ocr-engine.js functions/src/header-ocr.js functions/src/header-ocr.integration.test.js
git commit -m "feat: 画像からヘッダーを読み取る extractHeader を追加"
```

---

### Task 3: パイプラインと関数レスポンスに header を統合

**Files:**
- Modify: `functions/src/pipeline.js`
- Modify: `functions/index.js`

- [ ] **Step 1: `pipeline.js` で header を組み込む**

`functions/src/pipeline.js` を変更後の全文に置き換える:

```js
// functions/src/pipeline.js
// 営業明細画像（Buffer）→ アプリの日報データ（trips/rests/header）。
// 表: 前処理→PP-OCRv5→固定テンプレート復元→trip/rest変換（97-98%実証済）。
// ヘッダー: 表とは独立の経路（header-ocr.js）。表の経路には影響しない。
// 途中の画像・canvas はすべてメモリ上のみ。ディスクに保存しない。
import { preprocess } from "./preprocess.js";
import { recognizeBoxes } from "./ocr-engine.js";
import { reconstructRows } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";
import { extractHeader } from "./header-ocr.js";

/**
 * 営業明細画像をOCRし、アプリの日報データを返す。
 * @param {Buffer} imageBuffer 生画像（JPEG/PNG）
 * @returns {Promise<{trips:Array<object>, rests:Array<object>, header:object}>}
 *   trip/rest の各要素は js/parser.js の形式。低信頼セルは _ocrFlags を持つ。
 *   header は {date, departTime, returnTime, totalKm}（読めない項目は null）。
 */
export async function ocrReport(imageBuffer) {
  const canvas = await preprocess(imageBuffer);
  const boxes = await recognizeBoxes(canvas);
  const { rows } = reconstructRows({ boxes });
  const drive = rowsToDrive(rows || []);
  const header = await extractHeader(imageBuffer);
  return { trips: drive.trips, rests: drive.rests, header };
}
```

- [ ] **Step 2: `index.js` でレスポンスに header を含める**

`functions/index.js` の52-53行目を変更する。変更前:

```js
      const { trips, rests } = await ocrReport(imageBuffer);
      res.json({ trips, rests });
```

変更後:

```js
      const { trips, rests, header } = await ocrReport(imageBuffer);
      res.json({ trips, rests, header });
```

- [ ] **Step 3: パイプラインのテストを実行**

Run: `cd functions && npm test`
Expected: PASS（既存テストが壊れていないこと。`ocrReport` 自体のテストは無いが、構文エラーや import エラーが無いことを確認）

構文確認のため追加で:
Run: `cd functions && node --check src/pipeline.js && node --check index.js`
Expected: 出力なし（構文OK）

- [ ] **Step 4: コミット**

```bash
git add functions/src/pipeline.js functions/index.js
git commit -m "feat: OCR関数のレスポンスにヘッダー情報を追加"
```

---

### Task 4: アプリ側 — header を sessionStorage 経由で input.html へ渡す

**Files:**
- Modify: `js/ocr-import.js:110-121`

- [ ] **Step 1: `ocr-import.js` で header を受け取り保存する**

`js/ocr-import.js` の110-121行目を変更する。変更前:

```js
    const data = await res.json();
    const trips = data.trips || [];
    const rests = data.rests || [];
    if (trips.length === 0 && rests.length === 0) {
      statusEl.textContent = "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }

    // 結果を input.html へ引き渡す。確認・修正・日付入力は input.html で行う。
    statusEl.textContent = `読み取り完了: 乗車 ${trips.length}件 ・ 休憩 ${rests.length}回。日報入力ページへ移動します…`;
    sessionStorage.setItem("ocrImport", JSON.stringify({ trips, rests, ts: Date.now() }));
    location.href = "input.html";
```

変更後:

```js
    const data = await res.json();
    const trips = data.trips || [];
    const rests = data.rests || [];
    const header = data.header || null;
    if (trips.length === 0 && rests.length === 0) {
      statusEl.textContent = "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。";
      return;
    }

    // 結果を input.html へ引き渡す。確認・修正・日付入力は input.html で行う。
    statusEl.textContent = `読み取り完了: 乗車 ${trips.length}件 ・ 休憩 ${rests.length}回。日報入力ページへ移動します…`;
    sessionStorage.setItem("ocrImport", JSON.stringify({ trips, rests, header, ts: Date.now() }));
    location.href = "input.html";
```

- [ ] **Step 2: 構文確認**

Run: `node --check js/ocr-import.js`
Expected: 出力なし（構文OK）

- [ ] **Step 3: コミット**

```bash
git add js/ocr-import.js
git commit -m "feat: OCR取り込みでヘッダー情報をinput.htmlへ受け渡し"
```

---

### Task 5: input.html — 出庫時刻欄・総走行距離欄の追加とヘッダー反映

**Files:**
- Modify: `input.html`（UIフォーム / `applyOcrImport` / 編集モード復元 / saveBtn / 行番号は実装時に確認）
- Modify: `sw.js:1`

- [ ] **Step 1: 出庫時刻欄を追加する**

`input.html` の乗務種別・帰庫時刻のカード（74-87行目付近）を変更する。変更前:

```html
  <section class="card">
    <div style="display:flex;gap:8px;">
      <div style="flex:1;">
        <label class="muted">乗務種別</label>
        <select class="select" id="vehicleTypeSel">
          <option value="japantaxi">ジャパンタクシー</option>
          <option value="premium">プレミアム</option>
        </select>
      </div>
      <div style="flex:1;">
        <label class="muted">帰庫時刻</label>
        <input class="input" id="returnTimeInput" type="time">
      </div>
    </div>
    <label class="muted" style="margin-top:8px;display:block;">メモ</label>
    <textarea id="memoInput" rows="2" class="input"></textarea>
  </section>
```

変更後:

```html
  <section class="card">
    <div style="display:flex;gap:8px;">
      <div style="flex:1;">
        <label class="muted">乗務種別</label>
        <select class="select" id="vehicleTypeSel">
          <option value="japantaxi">ジャパンタクシー</option>
          <option value="premium">プレミアム</option>
        </select>
      </div>
      <div style="flex:1;">
        <label class="muted">出庫時刻</label>
        <input class="input" id="departTimeInput" type="time">
      </div>
      <div style="flex:1;">
        <label class="muted">帰庫時刻</label>
        <input class="input" id="returnTimeInput" type="time">
      </div>
    </div>
    <label class="muted" style="margin-top:8px;display:block;">総走行距離（km・回送込み）</label>
    <input class="input" id="totalKmInput" type="number" inputmode="numeric" placeholder="例: 309">
    <label class="muted" style="margin-top:8px;display:block;">メモ</label>
    <textarea id="memoInput" rows="2" class="input"></textarea>
  </section>
```

- [ ] **Step 2: 編集モードで出庫時刻・総走行距離を復元する**

`input.html` の編集モード復元部（188-193行目付近、`returnTimeInput` をセットしている箇所）を変更する。変更前:

```js
      document.getElementById('returnTimeInput').value = existing.returnTime || '';
      document.getElementById('memoInput').value = existing.memo || '';
```

変更後:

```js
      document.getElementById('returnTimeInput').value = existing.returnTime || '';
      document.getElementById('departTimeInput').value = existing.departureTime || '';
      document.getElementById('totalKmInput').value = existing.totalDistanceKm != null ? existing.totalDistanceKm : '';
      document.getElementById('memoInput').value = existing.memo || '';
```

- [ ] **Step 3: `applyOcrImport` でヘッダーを各欄へ反映する**

`input.html` の `applyOcrImport` 関数末尾、`hint.style.color = '#1565c0';` の直前に、ヘッダー反映処理を追加する。変更前（268-273行目付近）:

```js
  const hint = document.getElementById('dateHint');
  hint.innerHTML = '📷 写真から取り込みました。<b>日付</b>を確認し、' +
    `<b>帰庫時刻</b>${derivedReturn ? `（概算 ${derivedReturn}・要確認）` : ''}と車種も確認してください` +
    `。日付の自動判定: ${document.getElementById('dateInput').value}（タップで変更）。` +
    '明細はこの下の表で1セルずつ修正できます。';
  hint.style.color = '#1565c0';
```

変更後:

```js
  // ヘッダーOCR結果を各欄へ反映する。読めた項目だけ上書きする。
  // 出庫・帰庫はヘッダーの実値が明細からの概算より正確なので優先する。
  const header = (data && data.header) || null;
  let headerNote = '';
  if (header) {
    if (header.date) document.getElementById('dateInput').value = header.date;
    if (header.departTime) document.getElementById('departTimeInput').value = header.departTime;
    if (header.returnTime) {
      document.getElementById('returnTimeInput').value = header.returnTime;
      derivedReturn = ''; // ヘッダー実値があるので明細概算の注記は不要
    }
    if (header.totalKm != null) document.getElementById('totalKmInput').value = header.totalKm;
    const got = [];
    if (header.date) got.push('日付');
    if (header.departTime) got.push('出庫');
    if (header.returnTime) got.push('帰庫');
    if (header.totalKm != null) got.push('走行距離');
    if (got.length) headerNote = `ヘッダーから ${got.join('・')} を読み取りました。`;
  }

  const hint = document.getElementById('dateHint');
  hint.innerHTML = '📷 写真から取り込みました。' + headerNote +
    '<b>日付</b>を確認し、' +
    `<b>帰庫時刻</b>${derivedReturn ? `（概算 ${derivedReturn}・要確認）` : ''}と車種も確認してください` +
    `。日付の自動判定: ${document.getElementById('dateInput').value}（タップで変更）。` +
    '明細はこの下の表で1セルずつ修正できます。';
  hint.style.color = '#1565c0';
```

- [ ] **Step 4: saveBtn の drive オブジェクトに出庫時刻・総走行距離を含める**

`input.html` の `saveBtn.onclick` 内 drive オブジェクト（492-505行目付近）を変更する。変更前:

```js
  const drive = {
    date,
    vehicleType: document.getElementById('vehicleTypeSel').value,
    departureTime: config.defaults.departureTime,
    returnTime: document.getElementById('returnTimeInput').value || null,
    memo: document.getElementById('memoInput').value,
    rawText: document.getElementById('rawTextInput').value,
    trips: parsed.trips.map(stripOcrMeta),
    rests: (parsed.rests || []).map(stripOcrMeta),
    weather,
    violations: readViolations(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
```

変更後:

```js
  const totalKmRaw = document.getElementById('totalKmInput').value;
  const totalDistanceKm = totalKmRaw.trim() !== '' ? parseInt(totalKmRaw, 10) : null;
  const drive = {
    date,
    vehicleType: document.getElementById('vehicleTypeSel').value,
    departureTime: document.getElementById('departTimeInput').value || config.defaults.departureTime,
    returnTime: document.getElementById('returnTimeInput').value || null,
    totalDistanceKm: Number.isFinite(totalDistanceKm) ? totalDistanceKm : null,
    memo: document.getElementById('memoInput').value,
    rawText: document.getElementById('rawTextInput').value,
    trips: parsed.trips.map(stripOcrMeta),
    rests: (parsed.rests || []).map(stripOcrMeta),
    weather,
    violations: readViolations(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
```

- [ ] **Step 5: Service Worker のキャッシュ名を更新**

`sw.js` の1行目を変更する。変更前:

```js
const CACHE_NAME = 'taxi-daily-v149';
```

変更後:

```js
const CACHE_NAME = 'taxi-daily-v150';
```

- [ ] **Step 6: 構文確認**

Run: `node --check sw.js`
Expected: 出力なし（構文OK）

`input.html` の `<script>` ブロックは `node --check` できないため、ブラウザのコンソールでエラーが出ないことを Task 6 の実機確認で見る。

- [ ] **Step 7: コミット**

```bash
git add input.html sw.js
git commit -m "feat: 日報入力に出庫時刻・総走行距離欄を追加しヘッダーOCR結果を反映"
```

---

### Task 6: dev デプロイと実機確認

**Files:**
- なし（デプロイと検証のみ）

- [ ] **Step 1: 関数を dev プロジェクトへデプロイ**

throwaway ファイル（`functions/peek-*.mjs` 等）が `functions/` に残っていないことを確認してからデプロイする:

```bash
ls functions/peek-*.mjs 2>/dev/null && echo "削除が必要" || echo "クリーン"
```

`functions/` 以下にデバッグ用スクリプトが無いことを確認後、dev プロジェクトへデプロイ:

```bash
firebase deploy --only functions --project taxi-dailydata-dev
```

Expected: `ocrReportFn` のデプロイ成功。

- [ ] **Step 2: dev のホスティングへ反映**

dev リポジトリへ push し、GitHub Pages（dev）に反映する。実装中のコミットを dev/main へ push:

```bash
git push
```

Expected: push 成功。GitHub Pages（dev）が数分で更新される。

- [ ] **Step 3: 実機でヘッダー読み取りを確認（ユーザー作業）**

ユーザーに以下を依頼する:
1. dev環境のアプリで「写真から取り込み」を開く
2. 営業明細を撮影して取り込む
3. 日報入力ページで、日付・出庫時刻・帰庫時刻・総走行距離が自動で埋まっているか確認
4. ヒント文に「ヘッダーから 日付・出庫・帰庫・走行距離 を読み取りました」と出るか確認

確認ポイント:
- 4項目すべて埋まる → 成功
- 一部が空 → その項目のラベル/値の座標を `extractHeader` のデバッグ出力で調査し `parseHeaderBoxes` のしきい値を調整、Task 2 Step 4 へ戻る
- 表OCR（trips/rests）が従来どおり読めているか（ヘッダー追加で壊れていないこと）

- [ ] **Step 4: 本番反映（ユーザー承認後）**

ユーザーが dev での動作を承認したら本番へ反映する:

```bash
firebase deploy --only functions --project taxi-dailydata
```

本番ホスティングのリポジトリ（`taxi-daily-report` / `origin/main`）へ反映する。本番反映の手順は既存プラン `docs/superpowers/plans/2026-05-18-server-side-ocr-function.md` の Task 6 に従う。

Expected: 本番の `ocrReportFn` 更新、本番アプリでヘッダーOCRが動作。

---

## Self-Review

**1. Spec coverage（ユーザー要望）:**
- 処理日付 → `header.date` → `dateInput`（Task 1,2,5）✓
- 出庫日時 → `header.departTime` → `departTimeInput` → `drive.departureTime`（Task 1,2,5）✓
- 入庫日時 → `header.returnTime` → `returnTimeInput`（Task 1,2,5）✓
- 総走行距離（走行KM 309・回送込みメーター値）→ `header.totalKm` → `totalKmInput` → `drive.totalDistanceKm`（Task 1,2,5）✓
- 表OCRを壊さない → ヘッダーは独立経路、`preprocess`/`recognizeBoxes`/`reconstruct` 不変（Task 2,3）✓
- 画像の非保存・非ログ・第三者AI不使用 → `extractHeader` もメモリ上のみ、ログにエラー種別のみ（Task 2）✓
- dev→承認→本番 のデプロイフロー → Task 6 ✓

**2. Placeholder scan:** プレースホルダなし。全ステップに実コード・実コマンド・期待値あり。✓

**3. Type consistency:**
- `header` 型 `{date, departTime, returnTime, totalKm}` は Task 1（定義）→ Task 2（`extractHeader` 戻り）→ Task 3（`ocrReport` 戻り）→ Task 4（sessionStorage）→ Task 5（反映）で一貫。✓
- 関数名 `parseHeaderBoxes` / `extractHeader` / `getHeaderService` / `recognizeHeaderBoxes` は定義箇所と呼び出し箇所で一致。✓
- drive の新フィールド名 `totalDistanceKm` は Task 5 の保存・編集復元で一致。✓

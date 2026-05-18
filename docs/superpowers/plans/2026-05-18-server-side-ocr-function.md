# サーバー側OCR Cloud Function 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 営業明細の写真を Firebase Cloud Function 上で OCR し、構造化した日報データを返す（端末内OCRを廃止し、画像は外部AIに渡さずサーバー上でメモリ処理のみ・非保存）。

**Architecture:** アプリ（`ocr-import.html`）が画像を Cloud Function に POST → 関数がメモリ上で `前処理 → PP-OCRv5 → 固定テンプレート復元 → 漢字正規化・地名補正` を実行し `rows` を返す → アプリが既存の `rowsToDrive` → レビュー表 → `input.html` 取り込み、の流れに載せる。OCRエンジンは `ocr-spike/` で 97-98% 実証済みの Node パイプライン。AI API は使わない。画像はディスクにもログにも残さない。

**Tech Stack:** Node 20 / Firebase Cloud Functions 2nd gen (`onRequest`) / firebase-admin / ppu-paddle-ocr (Node) / ppu-ocv (Node) / onnxruntime-node / Firestore（利用回数カウンタ）

---

## 前提（実装開始前にユーザーが行う）

- **Firebase を Blaze プランに変更**（Cloud Functions 2nd gen に必須）。実利用量なら無料枠内＝¥0、カード登録のみ。
- 完了まで Task 1 以降のデプロイはできない（コードの実装・ローカル検証は先行可）。

## リスクと最重要ゲート

**Task 1 が make-or-break。** `onnxruntime-node`・`ppu-ocv`・`ppu-paddle-ocr` はネイティブ依存（WASM/native binary、canvas 系のシステムライブラリ）を含む。これらが Cloud Functions 2nd gen（Linux コンテナ）で動くかは未検証。Task 1 のスパイクで動作確認できてから Task 2 以降に進む。動かない場合は Cloud Run（カスタム Dockerfile）への切替を Task 1 内で判断する。

## ファイル構成

```
functions/
  package.json            — 関数の依存とNode版指定
  index.js                — Cloud Function エントリ（onRequest ハンドラ）
  src/
    pipeline.js           — 前処理→OCR→復元→後処理のオーケストレーション。entry: ocrReport(buffer)→{rows}
    preprocess.js         — ocr-spike/auto-preprocess.mjs を buffer入出力に改変
    ocr-engine.js         — PaddleOcrService 初期化＋recognize（run-paddle-v5 相当）
    template-reconstruct.js — js/ocr/src/ から移植（純ロジック・無改変）
    kanji-normalize.js    — js/ocr/src/ から移植（無改変）
    place-correct.js      — js/ocr/src/ から移植（無改変）
    to-drive.js           — js/ocr/src/ から移植（rows→trips/rests・無改変）
    quota.js              — ユーザー別1日上限（Firestore）
  data/
    keiho-template.json   — js/ocr/data/ から移植
    tokyo-chome.json      — js/ocr/data/ から移植
  models/                 — PP-OCRv5 det/rec モデル＋辞書（同梱）
firebase.json             — "functions" ブロック追加
js/ocr-import.js          — 関数POST方式に作り替え
ocr-import.html           — 据え置き（badge等そのまま）
```

撤去対象（Task 6）: `js/ocr/`（src・bundle・data）、`js/ocr-worker.js`、`ocr-worker.html`、`build-ocr.mjs`、`package.json` の OCR 用 devDeps。

---

## Task 1: ネイティブ依存スパイク（make-or-break 検証）

**目的:** OCRライブラリ群が Cloud Functions 2nd gen で動くかを最小構成で確認する。

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.js`（スパイク用・後で本実装に差し替え）
- Modify: `firebase.json`

- [ ] **Step 1: firebase.json に functions を追加**

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "functions": [{ "source": "functions", "codebase": "default" }]
}
```

- [ ] **Step 2: functions/package.json を作成**

```json
{
  "name": "taxi-ocr-functions",
  "type": "module",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0",
    "onnxruntime-node": "^1.26.0",
    "ppu-paddle-ocr": "^5.4.4",
    "ppu-ocv": "^3.1.5",
    "sharp": "^0.33.5"
  }
}
```

- [ ] **Step 3: スパイク用 index.js を作成**

PP-OCRv5 を1回初期化し、固定の小さなテスト画像（base64 を関数内に埋め込み）を OCR して検出ボックス数を返すだけの 2nd-gen 関数。メモリ 2GiB / timeout 120s。

```js
import { onRequest } from "firebase-functions/v2/https";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { createCanvas, loadImage } from "ppu-ocv";

const MODEL_BASE = "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";
const DICT_BASE = "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

let svc = null;
async function getSvc() {
  if (svc) return svc;
  const s = new PaddleOcrService({
    model: {
      detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
      recognition: `${MODEL_BASE}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
      charactersDictionary: `${DICT_BASE}/recognition/ppocrv5_dict.txt`,
    },
    processing: { engine: "canvas-native" },
    detection: { maxSideLength: 1600, minimumAreaThreshold: 20 },
  });
  await s.initialize();
  svc = s;
  return s;
}

export const ocrSpike = onRequest({ memory: "2GiB", timeoutSeconds: 120 }, async (req, res) => {
  try {
    const service = await getSvc();
    // テスト画像: 白地に文字を描いた canvas（外部画像に依存しない）
    const canvas = createCanvas(400, 120);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 400, 120);
    ctx.fillStyle = "#000"; ctx.font = "40px sans-serif";
    ctx.fillText("12:34 5,100", 20, 70);
    const result = await service.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
    res.json({ ok: true, boxes: (result.results || []).length, texts: (result.results || []).map(r => r.text) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.stack || e) });
  }
});
```

- [ ] **Step 4: ローカルエミュレータで実行**

Run: `cd functions && npm install && cd .. && firebase emulators:start --only functions`
別シェルで: `curl http://127.0.0.1:5001/<project-id>/us-central1/ocrSpike`
Expected: `{"ok":true,"boxes":N,"texts":[...]}` で texts に "12:34" 等が含まれる。

- [ ] **Step 5: dev プロジェクトへデプロイして実行**

Run: `firebase deploy --only functions:ocrSpike`
デプロイ後、関数URLに `curl`。Expected: ローカルと同じ `ok:true`。

**判定:**
- 成功 → Task 2 へ。
- ネイティブ依存のビルド/実行が失敗 → ここで停止し、Cloud Run（`functions/Dockerfile` で opencv/canvas のシステムライブラリを明示インストール）への切替を人間と相談。**この場合 Task 2 以降のファイル構成は維持できる**（ハンドラの置き場所だけ変わる）。

- [ ] **Step 6: コミット**

```bash
git add firebase.json functions/package.json functions/index.js functions/package-lock.json
git commit -m "spike(ocr): Cloud Function でPP-OCRネイティブ依存の動作確認"
```

---

## Task 2: OCRパイプラインを functions/ へ移植

**目的:** `ocr-spike` / `js/ocr/src` の検証済みコードを関数用に移植し、`buffer → {rows}` の純粋関数 `ocrReport` を作る。

**Files:**
- Copy 無改変: `js/ocr/src/template-reconstruct.js`・`kanji-normalize.js`・`place-correct.js`・`to-drive.js` → `functions/src/`
- Copy 無改変: `js/ocr/data/keiho-template.json`・`tokyo-chome.json` → `functions/data/`
- Create: `functions/src/preprocess.js`（`ocr-spike/auto-preprocess.mjs` を buffer 入出力へ改変）
- Create: `functions/src/ocr-engine.js`
- Create: `functions/src/pipeline.js`
- Create: `functions/models/`（PP-OCRv5 det/rec `.onnx` と `ppocrv5_dict.txt` を配置）

- [ ] **Step 1: 純ロジック4ファイルを無改変コピー**

`template-reconstruct.js`・`kanji-normalize.js`・`place-correct.js`・`to-drive.js` は DOM 非依存の純データ処理。`js/ocr/src/` の各ファイルをそのまま `functions/src/` へコピー。import 文がローカル相対（`./kanji-normalize.js` 等）であることを確認、変更不要。`keiho-template.json`・`tokyo-chome.json` も `functions/data/` へコピーし、参照パスを `functions/src` 基準に合わせる。

Run（コピー後の確認）: `node --input-type=module -e "import('./functions/src/template-reconstruct.js').then(m=>console.log(typeof m.reconstructRows))"`
Expected: `function`

- [ ] **Step 2: モデルを同梱**

`functions/models/` に PP-OCRv5 detection (`PP-OCRv5_mobile_det_infer.onnx`)・recognition (`PP-OCRv5_mobile_rec_infer.onnx`)・`ppocrv5_dict.txt` を配置（`media.githubusercontent.com` から取得し commit、またはデプロイ前取得スクリプト）。コールドスタートで外部fetchしないため。

- [ ] **Step 3: preprocess.js を buffer 入出力へ改変**

`ocr-spike/auto-preprocess.mjs` の `orient/detectDocument/rectify/deskew/grayscaleResize` をそのまま使い、入口/出口だけ差し替える。ファイルパスではなく `Buffer` を受け、canvas を返す（PNG保存しない＝ディスク非使用）。

```js
// functions/src/preprocess.js
import { ImageProcessor, Contours, DeskewService, cv, loadImage, createCanvas } from "ppu-ocv";
// orient / detectDocument / rectify / deskew / grayscaleResize は
// ocr-spike/auto-preprocess.mjs の同名関数を無改変で移す（本ファイル内に同梱）。

export async function preprocess(imageBuffer) {
  await ImageProcessor.initRuntime();
  const img = await loadImage(imageBuffer);          // Buffer を直接読む
  let canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  canvas = orient(canvas);
  const corners = detectDocument(canvas);
  canvas = rectify(canvas, corners);
  canvas = await deskew(canvas);
  canvas = grayscaleResize(canvas);
  return canvas;                                     // canvas を返す（保存しない）
}
```

- [ ] **Step 4: ocr-engine.js を作成**

`run-paddle-v5.mjs` の `PaddleOcrService` 設定を流用。モデルは同梱パス（`functions/models/`）を指す。

```js
// functions/src/ocr-engine.js
import { PaddleOcrService } from "ppu-paddle-ocr";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models");
let service = null;

export async function getService() {
  if (service) return service;
  const s = new PaddleOcrService({
    model: {
      detection: path.join(MODELS, "PP-OCRv5_mobile_det_infer.onnx"),
      recognition: path.join(MODELS, "PP-OCRv5_mobile_rec_infer.onnx"),
      charactersDictionary: path.join(MODELS, "ppocrv5_dict.txt"),
    },
    processing: { engine: "canvas-native" },
    detection: { maxSideLength: 1600, minimumAreaThreshold: 20 },
  });
  await s.initialize();
  service = s;
  return s;
}

export async function recognizeBoxes(canvas) {
  const svc = await getService();
  const ocr = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  return (ocr.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
}
```

- [ ] **Step 5: pipeline.js でオーケストレーション**

```js
// functions/src/pipeline.js
import { preprocess } from "./preprocess.js";
import { recognizeBoxes } from "./ocr-engine.js";
import { reconstructRows } from "./template-reconstruct.js";

/** 画像Buffer → 構造化行。途中の画像はメモリ上のみ・保存しない。 */
export async function ocrReport(imageBuffer) {
  const canvas = await preprocess(imageBuffer);
  const boxes = await recognizeBoxes(canvas);
  const { rows } = reconstructRows({ boxes });
  return { rows: rows || [] };
}
```

注: `template-reconstruct.js` が内部で `kanji-normalize`・`place-correct` を呼ぶ場合は Step 1 のコピーで連動済み。呼んでいない場合は `pipeline.js` で明示的に適用する（コピー時に `js/ocr/src/index.js` の結線を確認して合わせる）。

- [ ] **Step 6: ローカル精度検証**

`functions/` 内に使い捨て検証スクリプトを書き、`ocr-spike/test-images/2026-05-10.png` を `ocrReport` に通し、`ocr-spike/ground-truth/2026-05-10.json` と突き合わせる（`batch-test.mjs` の比較ロジック流用）。
Expected: 数値・時刻ほぼ100%・地名95%以上（ocr-spike 実証値と同等）。下回る場合は移植ミス（テンプレート参照パス等）を疑う。

- [ ] **Step 7: コミット**

```bash
git add functions/src functions/data functions/models
git commit -m "feat(ocr): OCRパイプラインを functions/ へ移植（buffer入出力）"
```

---

## Task 3: HTTPハンドラ（認証・上限・非保存）

**目的:** 画像を受け取り、ログインを検証し、ユーザー別1日上限を確認し、`ocrReport` を実行して `rows` を返す。画像はメモリのみ・ログ出力しない。

**Files:**
- Create: `functions/src/quota.js`
- Modify: `functions/index.js`（スパイクを本実装へ差し替え）

- [ ] **Step 1: quota.js — ユーザー別1日上限**

Firestore `ocrUsage/{uid}` ドキュメントに `{date, count}` を保持。日付が変われば 0 にリセット。上限 `DAILY_LIMIT = 20`（通常1日報1回。リトライ・複数日報を許容しつつ暴走を止める値）。

```js
// functions/src/quota.js
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const DAILY_LIMIT = 20;

/** 上限内なら count を1増やし true。超過なら false。 */
export async function consumeQuota(uid) {
  const db = getFirestore();
  const ref = db.collection("ocrUsage").doc(uid);
  const today = new Date().toISOString().slice(0, 10);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.date === today ? (data.count || 0) : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(ref, { date: today, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}
```

- [ ] **Step 2: index.js を本実装に差し替え**

```js
// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ocrReport } from "./src/pipeline.js";
import { consumeQuota } from "./src/quota.js";

initializeApp();

export const ocrReportFn = onRequest(
  { memory: "2GiB", timeoutSeconds: 300, cors: true },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST のみ" });

      // 認証: Authorization: Bearer <Firebase IDトークン>
      const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ error: "認証が必要です" });
      let uid;
      try { uid = (await getAuth().verifyIdToken(m[1])).uid; }
      catch { return res.status(401).json({ error: "ログインが無効です" }); }

      // 利用上限
      if (!(await consumeQuota(uid))) {
        return res.status(429).json({ error: "本日の取り込み回数の上限に達しました" });
      }

      // 画像（JSON body: { image: "<base64>" }）。メモリ上のみ・保存もログもしない。
      const b64 = (req.body && req.body.image) || "";
      if (!b64) return res.status(400).json({ error: "画像がありません" });
      const buffer = Buffer.from(b64, "base64");

      const { rows } = await ocrReport(buffer);
      return res.json({ rows });
    } catch (e) {
      // 画像内容はログに出さない。エラー種別のみ。
      console.error("ocrReportFn error:", e && e.message);
      return res.status(500).json({ error: "解析に失敗しました" });
    }
  }
);
```

注: `req.body.image` の base64 を直接 `console.log` しない（非保存・非ログの原則）。

- [ ] **Step 3: エミュレータで結合確認**

`firebase emulators:start --only functions,firestore`。ダミーIDトークン or エミュレータの auth で、`2026-05-10.png` の base64 を POST。
Expected: `{ rows: [...] }` が返り、行数が想定どおり。再 POST を上限まで繰り返し、21回目に `429`。

- [ ] **Step 4: コミット**

```bash
git add functions/index.js functions/src/quota.js
git commit -m "feat(ocr): OCR Cloud Function ハンドラ（認証・1日上限・非保存）"
```

---

## Task 4: アプリ側を関数POST方式に作り替え

**目的:** `ocr-import` から端末内OCRを外し、画像を Cloud Function に送って `rows` を受け取る。受け取った後の流れ（`rowsToDrive` → レビュー表 → `input.html` 取り込み）は現状を維持。

**Files:**
- Modify: `js/ocr-import.js`（全面作り替え）
- Modify: `sw.js`（OCR関連 STATIC_FILES とキャッシュ版更新）

- [ ] **Step 1: ocr-import.js を作り替え**

端末内OCR（バンドル動的import・iframe・診断 diag）を削除。`to-drive.js` の `rowsToDrive` はアプリ側にも1部必要 → `js/ocr-import-lib.js` として `rowsToDrive` のみ残す（または関数の応答に trips/rests を含める）。画像取得 → Firebase IDトークン取得 → `fetch(FUNCTION_URL, {method:"POST", headers:{Authorization}, body:JSON image})` → `rows` → `rowsToDrive` → `renderReview`。`renderReview`・`cell`・importBtn ハンドラは現状の実装を維持。

検証: dev で写真選択 → 「解析中…」→ レビュー表表示 → 「日報に取り込む」で `input.html` に反映。

- [ ] **Step 2: sw.js 更新**

STATIC_FILES から `js/ocr-worker.js`・`ocr-worker.html` を削除（Task 6 で実ファイルも削除）。`CACHE_NAME` を次の版へ。

- [ ] **Step 3: コミット**

```bash
git add js/ocr-import.js js/ocr-import-lib.js sw.js
git commit -m "feat(ocr): 写真取り込みをサーバー関数POST方式に変更"
```

---

## Task 5: 端末内OCRの撤去

**目的:** 使われなくなった端末内OCR資産を削除し、リポジトリを整理する。

**Files:**
- Delete: `js/ocr/`（src・ocr-bundle.js・data・vendor）、`js/ocr-worker.js`、`ocr-worker.html`、`build-ocr.mjs`
- Modify: `package.json`（OCR用 devDeps `esbuild` 等・dependencies の onnxruntime-web/ppu-paddle-ocr を撤去。アプリ本体が他で使っていないこと grep 確認）

- [ ] **Step 1: 参照が無いことを確認**

Run: `grep -rn "ocr/ocr-bundle\|ocr-worker\|js/ocr/" --include=*.html --include=*.js . | grep -v node_modules`
Expected: ヒット無し（Task 4 完了後）。

- [ ] **Step 2: 削除＋package.json整理＋コミット**

```bash
git rm -r js/ocr js/ocr-worker.js ocr-worker.html build-ocr.mjs
git commit -m "chore(ocr): 端末内OCR資産を撤去（サーバー方式へ移行済み）"
```

- [ ] **Step 3: 全テスト**

Run: `node --test tests/*.test.js`
Expected: 全 pass（テストは js/ocr 非依存のため影響なし）。

---

## Task 6: dev デプロイ → 実機テスト → 本番

- [ ] **Step 1: dev へ関数とアプリを反映**

`firebase deploy --only functions:ocrReportFn`（dev プロジェクト）。アプリ側コミットを dev/main へ反映（既存の deploy 手順）。`js/ocr-import.js` の `FUNCTION_URL` を dev 関数URLに設定。

- [ ] **Step 2: ユーザーがiPhone実機テスト**

dev の `ocr-import.html` で実際の営業明細を撮影 → 取り込み。精度（特に金額・時刻）と所要時間を確認。

- [ ] **Step 3: 本番反映**

ユーザー承認後、本番 Firebase へ関数デプロイ＋アプリを `origin/main` へ反映。`FUNCTION_URL` を本番関数URLに（dev/prod で環境別に切替）。

---

## Self-Review

- **Spec coverage:** 画像→関数→OCR→rows（Task 2,3）/ 非保存・非ログ（Task 3 Step 2 注記）/ 認証・1日上限（Task 3）/ アプリ作り替え（Task 4）/ 端末内OCR撤去（Task 5）/ dev→実機→本番（Task 6）。Blaze 前提は冒頭に明記。
- **未確定の最大リスク:** ネイティブ依存が Cloud Functions で動くか（Task 1 で先に検証、ダメなら Cloud Run 切替）。
- **要確認（実装時）:** `js/ocr/src/index.js` の結線を見て `kanji-normalize`/`place-correct` が `template-reconstruct` 内で呼ばれるか `index` で呼ばれるかを確認し、`pipeline.js` を合わせる（Task 2 Step 5）。`FUNCTION_URL` の dev/prod 切替方法（`location.hostname` 判定など、他ページの dev 判定に倣う）。

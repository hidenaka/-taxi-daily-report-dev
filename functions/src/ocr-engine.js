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

// canvas を指定サービスでOCRし、検出ボックス配列に変換する共通処理。
// per-box: 検出ボックスを1つずつ認識（密な表ではper-lineより適切）。
async function recognizeWith(svc, canvas) {
  const ocr = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  return (ocr.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
}

/**
 * 前処理済み canvas を表OCRサービスでOCRし、検出ボックス配列を返す。
 * @param {object} canvas
 * @returns {Promise<Array<{text:string,bbox:number[],confidence:number}>>}
 */
export async function recognizeBoxes(canvas) {
  return recognizeWith(await getService(), canvas);
}

/**
 * ヘッダー帯 canvas をヘッダー用サービスでOCRし、検出ボックス配列を返す。
 * @param {object} canvas
 * @returns {Promise<Array<{text:string,bbox:number[],confidence:number}>>}
 */
export async function recognizeHeaderBoxes(canvas) {
  return recognizeWith(await getHeaderService(), canvas);
}

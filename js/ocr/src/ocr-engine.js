// js/ocr/src/ocr-engine.js
// PP-OCR（ppu-paddle-ocr web版）のラッパ。検出・認識ともに基盤 PP-OCRv5。
// 設定は ocr-spike/run-paddle-v5.mjs（Node検証済み）と同一。
// 注: ppu-paddle-ocr の web ビルドは画像処理に canvas-native を使う（OpenCV不要）。
import { PaddleOcrService } from "ppu-paddle-ocr/web";

// 認識は基盤 PP-OCRv5 mobile（多言語＝日本語＋数字を高精度に読む）。検出もv5。
// v5は日本語を簡体字字形で出すことがあるため、grid-reconstruct 側で
// kanji-normalize による日本語常用漢字への正規化を行う。
const MODEL_BASE = "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";
const DICT_BASE = "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

let service = null;

/**
 * PP-OCRサービスを初期化（モデルをfetchしロード）。初回は時間がかかる。
 * 2回目以降は同一インスタンスを返す。
 */
export async function initOcr() {
  if (service) return service;
  const svc = new PaddleOcrService({
    model: {
      detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
      recognition: `${MODEL_BASE}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
      charactersDictionary: `${DICT_BASE}/recognition/ppocrv5_dict.txt`,
    },
    // 明細表の小さい数字を拾うため検出解像度を上げる（Phase 0/1A検証で確定）。
    detection: { maxSideLength: 1600, minimumAreaThreshold: 20 },
  });
  await svc.initialize();
  service = svc;
  return service;
}

/**
 * 前処理済みcanvasをOCRする。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {(stage:string)=>void} [onStage] "model-load"/"recognize" の開始を通知する。
 * @returns {Promise<{text:string, boxes:Array<{text:string,bbox:number[],confidence:number}>}>}
 */
export async function runOcr(canvas, onStage) {
  const report = (s) => { if (typeof onStage === "function") onStage(s); };
  report("model-load");
  const svc = await initOcr();
  // per-box: 検出ボックスを1つずつ認識（密な表ではper-lineより適切）。
  report("recognize");
  const result = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  const boxes = (result.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
  return { text: result.text, boxes };
}

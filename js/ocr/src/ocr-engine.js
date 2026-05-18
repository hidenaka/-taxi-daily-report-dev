// js/ocr/src/ocr-engine.js
// PP-OCR（ppu-paddle-ocr web版）のラッパ。1枚の画像（=帯）をOCRする。
// 検出・認識ともに基盤 PP-OCRv5。設定は ocr-spike/run-paddle-v5.mjs と同一。
//
// 帯分割の計画・結合は strips.js が、帯ごとの隔離実行（使い捨てiframe）は
// ocr-import.js / ocr-worker が担う。このモジュールは「与えられた1枚を
// OCRして box を返す」ことだけに集中する。
import { PaddleOcrService } from "ppu-paddle-ocr/web";

// 認識は基盤 PP-OCRv5 mobile（多言語＝日本語＋数字を高精度に読む）。検出もv5。
const MODEL_BASE = "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";
const DICT_BASE = "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

let service = null;

// ppu-paddle-ocr は session.run の出力テンソルを dispose しない。per-box 認識は
// 多数の inference を回すため、出力テンソルが抱える onnxruntime-web の WASMメモリ
// が積み上がる。runInference をラップし、次の推論直前に前回の出力を dispose する。
function patchTensorDisposal(servicePart) {
  if (!servicePart || typeof servicePart.runInference !== "function") return;
  const original = servicePart.runInference.bind(servicePart);
  let previous = null;
  servicePart.runInference = async (...args) => {
    if (previous && typeof previous.dispose === "function") {
      try { previous.dispose(); } catch (_) {}
    }
    previous = null;
    const out = await original(...args);
    if (out && typeof out.dispose === "function") previous = out;
    return out;
  };
}

/**
 * PP-OCRサービスを初期化（モデルをfetchしロード）。初回は時間がかかる。
 * 2回目以降は同一インスタンスを返す。
 * 注: 使い捨てiframe内では realm ごとに1回だけ呼ばれる。
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
  patchTensorDisposal(svc.recognitor);
  service = svc;
  return service;
}

/**
 * 各種の画像ソースを HTMLCanvasElement に正規化する。
 * @param {File|Blob|HTMLImageElement|HTMLCanvasElement|ImageBitmap} src
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function toCanvas(src) {
  if (typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement) return src;

  let bitmap;
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) {
    bitmap = src;
  } else if (src instanceof Blob) {
    bitmap = await createImageBitmap(src); // File は Blob のサブクラス
  } else if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    bitmap = await createImageBitmap(src);
  } else {
    throw new Error("対応していない画像ソースです（File/Blob/HTMLImageElement/HTMLCanvasElement/ImageBitmap）");
  }

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
}

/**
 * 1枚の画像（前処理済みの帯）をOCRし、検出ボックスを返す。
 * 帯ローカル座標の box を返す（画像全体への補正は mergeStripResults が行う）。
 * @param {ImageBitmap|HTMLCanvasElement|Blob} imageSource
 * @returns {Promise<{boxes:Array<{text:string,bbox:number[],confidence:number}>}>}
 */
export async function recognizeStrip(imageSource) {
  const canvas = await toCanvas(imageSource);
  const svc = await initOcr();
  // per-box: 検出ボックスを1つずつ認識（密な表ではper-lineより適切）。
  const result = await svc.recognize(canvas, { flatten: true, noCache: true, strategy: "per-box" });
  const boxes = (result.results || []).map((r) => ({
    text: r.text,
    bbox: [r.box.x, r.box.y, r.box.x + r.box.width, r.box.y + r.box.height],
    confidence: r.confidence,
  }));
  return { boxes };
}

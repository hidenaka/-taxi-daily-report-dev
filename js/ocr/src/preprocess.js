// js/ocr/src/preprocess.js
// 営業明細写真の前処理（ブラウザ版）。
// 生画像canvas → 向き補正 → 書類検出 → 条件付き台形補正 → 傾き補正 → グレースケール＋拡大。
// ロジックは ocr-spike/auto-preprocess.mjs（Node検証済み・Phase 1A）と同一。
// Node版との違い: 入出力は HTMLCanvasElement、fs入出力なし。
import "./opencv-runtime.js"; // globalThis.cv に OpenCV を登録（ppu-ocv/web より前に）
import { ImageProcessor, Contours, DeskewService, cv } from "ppu-ocv/web";

// 粗い向き補正。営業明細は縦長なので、横長画像は90°回転して縦長にする。
function orient(canvas) {
  if (canvas.width > canvas.height) {
    return new ImageProcessor(canvas).rotate({ angle: -90 }).toCanvas();
  }
  return canvas;
}

// 書類の4隅を検出。{points, bbox} を返す。取れなければ null。
function detectDocument(canvas) {
  const proc = new ImageProcessor(canvas).grayscale().blur().canny({ lower: 50, upper: 150 });
  const contours = new Contours(proc.img, { mode: cv.RETR_EXTERNAL, method: cv.CHAIN_APPROX_SIMPLE });
  let result = null;
  try {
    if (contours.getSize() > 0) {
      const rectContour = contours.getApproximateRectangleContour({ threshold: 0.02 });
      const contour = rectContour && rectContour.rows >= 4 ? rectContour : undefined;
      result = contours.getCornerPoints({ canvas, contour });
    }
  } catch (e) {
    console.warn("detectDocument: 検出失敗、全体を使用:", e.message);
    result = null;
  }
  contours.destroy();
  proc.destroy();
  return result;
}

// 4隅で透視変換し正立矩形へ。
// 検出quadが画像のほぼ全域を覆う時だけ補正する（=紙の縁を捉えている）。
// 内側の表枠など部分的なquadは誤検出とみなしスキップ（部分クロップを防ぐ）。
function rectify(canvas, corners) {
  if (!corners || !corners.points) return canvas;
  const p = corners.points;
  const pts = [p.topLeft, p.topRight, p.bottomLeft, p.bottomRight].filter(Boolean);
  if (pts.length < 4) return canvas;
  const xs = pts.map((c) => c.x), ys = pts.map((c) => c.y);
  const spreadX = (Math.max(...xs) - Math.min(...xs)) / canvas.width;
  const spreadY = (Math.max(...ys) - Math.min(...ys)) / canvas.height;
  if (spreadX < 0.85 || spreadY < 0.85) return canvas;
  return new ImageProcessor(canvas).warp({ points: corners.points, bbox: corners.bbox }).toCanvas();
}

// 微傾き補正。DeskewService がテキスト領域から傾き角を推定して補正する。
async function deskew(canvas) {
  try {
    return await new DeskewService().deskewImage(canvas);
  } catch (e) {
    console.warn("deskew: 失敗、スキップ:", e.message);
    return canvas;
  }
}

// グレースケール化し、OCR検出に十分な解像度へ拡大。
// 注: 適応的二値化は Phase 1A で PP-OCR 精度を落としたため不採用。
function grayscaleResize(canvas) {
  const targetW = 3200;
  const targetH = Math.round(canvas.height * (targetW / canvas.width));
  return new ImageProcessor(canvas)
    .grayscale()
    .resize({ width: targetW, height: targetH })
    .toCanvas();
}

/**
 * 生画像canvasを前処理し、OCR投入可能なcanvasを返す。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {Promise<HTMLCanvasElement|OffscreenCanvas>}
 */
export async function preprocessImage(canvas) {
  await ImageProcessor.initRuntime();
  let c = orient(canvas);
  const corners = detectDocument(c);
  c = rectify(c, corners);
  c = await deskew(c);
  c = grayscaleResize(c);
  return c;
}

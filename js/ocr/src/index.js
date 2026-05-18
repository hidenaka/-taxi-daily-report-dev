// js/ocr/src/index.js
// 端末内OCRのエントリ。画像 → 前処理 → PP-OCR → グリッド復元 → {text, boxes, rows}。
import { preprocessImage } from "./preprocess.js";
import { runOcr } from "./ocr-engine.js";
import { reconstructRows } from "./grid-reconstruct.js";

export { checkBlur } from "./quality.js";
export { reconstructRows } from "./grid-reconstruct.js";
export { rowsToDrive } from "./to-drive.js";

// 各種の画像ソースを HTMLCanvasElement に正規化する。
async function toCanvas(src) {
  if (typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement) return src;

  let bitmap;
  if (src instanceof Blob) {
    bitmap = await createImageBitmap(src); // File は Blob のサブクラス
  } else if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    bitmap = await createImageBitmap(src);
  } else if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) {
    bitmap = src;
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
 * 営業明細の画像を端末内でOCRし、明細行を構造データに復元する。
 * `rows` はグリッド復元の結果（明細行の構造データ）。
 * `text`/`boxes` は後方互換のためそのまま維持する。
 * @param {File|Blob|HTMLImageElement|HTMLCanvasElement|ImageBitmap} imageSource
 * @returns {Promise<{text:string, boxes:Array<{text:string,bbox:number[],confidence:number}>, rows:Array<Object>}>}
 */
export async function recognizeReport(imageSource) {
  const canvas = await toCanvas(imageSource);
  const preprocessed = await preprocessImage(canvas);
  const ocr = await runOcr(preprocessed);
  const { rows } = reconstructRows(ocr);
  return { ...ocr, rows };
}

// js/ocr/src/quality.js
// 撮影画像のブレ・ピンボケ判定。Laplacian の分散が低いほど不鮮明。
import "./opencv-runtime.js";
import { ImageProcessor, cv } from "ppu-ocv/web";

/**
 * 画像のブレ度合いを判定する。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {number} threshold variance がこれ未満なら不鮮明とみなす（既定100）
 * @returns {Promise<{variance:number, blurry:boolean}>}
 */
export async function checkBlur(canvas, threshold = 100) {
  await ImageProcessor.initRuntime();
  const proc = new ImageProcessor(canvas).grayscale();
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.Laplacian(proc.img, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, stddev);
    const sd = stddev.data64F[0];
    const variance = sd * sd;
    return { variance, blurry: variance < threshold };
  } finally {
    lap.delete();
    mean.delete();
    stddev.delete();
    proc.destroy();
  }
}

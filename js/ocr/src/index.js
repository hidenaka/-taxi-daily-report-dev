// js/ocr/src/index.js
// 端末内OCRバンドルの公開API。
//
// iframe隔離方式の組み立て（ocr-import.js が親ページで実行）:
//   preprocessImage → planStrips → 各帯を使い捨てiframeで recognizeStrip
//   → mergeStripResults → reconstructRows → rowsToDrive
// iframe（ocr-worker）側は recognizeStrip のみ使う。
import { toCanvas, recognizeStrip } from "./ocr-engine.js";
import { preprocessImage } from "./preprocess.js";
import { reconstructRows } from "./template-reconstruct.js";

export { preprocessImage } from "./preprocess.js";
export { checkBlur } from "./quality.js";
export { recognizeStrip } from "./ocr-engine.js";
export { planStrips, mergeStripResults } from "./strips.js";
export { reconstructRows } from "./template-reconstruct.js";
export { rowsToDrive } from "./to-drive.js";

/**
 * 営業明細の画像を端末内でOCRし、明細行を構造データに復元する（単発版・分割なし）。
 * メモリに余裕のあるPC等の検証用（ocr-test.html）。iPhone等は ocr-import.js が
 * iframe隔離方式で帯分割実行するため、この関数は通らない。
 * @param {File|Blob|HTMLImageElement|HTMLCanvasElement|ImageBitmap} imageSource
 * @returns {Promise<{boxes:Array<Object>, rows:Array<Object>}>}
 */
export async function recognizeReport(imageSource) {
  const canvas = await toCanvas(imageSource);
  const preprocessed = await preprocessImage(canvas);
  const { boxes } = await recognizeStrip(preprocessed);
  const { rows } = reconstructRows({ text: "", boxes });
  return { boxes, rows };
}

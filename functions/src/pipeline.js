// functions/src/pipeline.js
// 営業明細画像（Buffer）→ アプリの日報データ（trips/rests）。
// 前処理→PP-OCRv5→固定テンプレート復元（漢字正規化・地名補正を内包）→trip/rest変換。
// 途中の画像・canvas はすべてメモリ上のみ。ディスクに保存しない。
import { preprocess } from "./preprocess.js";
import { recognizeBoxes } from "./ocr-engine.js";
import { reconstructRows } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";

/**
 * 営業明細画像をOCRし、アプリの日報データを返す。
 * @param {Buffer} imageBuffer 生画像（JPEG/PNG）
 * @returns {Promise<{trips:Array<object>, rests:Array<object>}>}
 *   trip/rest の各要素は js/parser.js の形式。低信頼セルは _ocrFlags を持つ。
 */
export async function ocrReport(imageBuffer) {
  const canvas = await preprocess(imageBuffer);
  const boxes = await recognizeBoxes(canvas);
  const { rows } = reconstructRows({ boxes });
  return rowsToDrive(rows || []);
}

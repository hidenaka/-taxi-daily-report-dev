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

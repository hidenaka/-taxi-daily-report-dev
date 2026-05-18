// js/ocr/src/strips.js
// 営業明細の縦分割（帯）の計画と、帯ごとのOCR結果の結合。
//
// iframe隔離方式: 各帯は親ページが切り出し、使い捨てiframeでOCRする。
// onnxruntime のWASMメモリは一度確保するとページ内で解放できないため、
// 帯ごとにiframeを破棄してメモリをリセットする。このモジュールは
// 「どこで切るか（planStrips）」と「帯ごとの結果をどう繋ぐか（mergeStripResults）」
// を担う。OCR推論そのものは ocr-engine.js / iframe 側。

const STRIP_HEIGHT = 1200; // 1帯の高さ目安（px）。小さいほど1帯あたりのメモリは下がる
const STRIP_OVERLAP = 320; // 帯どうしの重なり（px）。最大行高より大きく取り、
//                            どの行も必ずいずれか1帯の内部に完全に収まるようにする
const SINGLE_STRIP_MAX = 2200; // この高さ以下なら分割しない（1帯で処理）
const EDGE_MARGIN = 8; // 帯の切れ目に接する box の判定マージン（px）
const DEDUPE_IOU = 0.5; // この重なり率を超える box 同士は同一とみなす

/**
 * 前処理済み画像の高さから帯の {y0,y1} リストを作る。
 * @param {number} height 前処理済み画像の高さ（px）
 * @returns {Array<{y0:number,y1:number}>}
 */
export function planStrips(height) {
  if (height <= SINGLE_STRIP_MAX) return [{ y0: 0, y1: height }];
  const advance = STRIP_HEIGHT - STRIP_OVERLAP;
  const strips = [];
  for (let y0 = 0; y0 < height; y0 += advance) {
    const y1 = Math.min(height, y0 + STRIP_HEIGHT);
    strips.push({ y0, y1 });
    if (y1 >= height) break;
  }
  return strips;
}

// 2つの bbox（[x0,y0,x1,y1]）の IoU（重なり率）。
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

/**
 * 帯ごとのOCR結果を画像全体の座標系に結合する。
 * 各帯の box の bbox は帯ローカル座標。画像全体座標へ補正し、帯の切れ目で
 * 見切れた box を除去し、重なりの二重検出を IoU で除去する。
 * @param {Array<{y0:number,y1:number,index:number,total:number,
 *   boxes:Array<{text:string,bbox:number[],confidence:number}>}>} stripResults
 * @returns {Array<{text:string,bbox:number[],confidence:number}>} 画像全体座標の box 配列
 */
export function mergeStripResults(stripResults) {
  const collected = [];
  for (const strip of stripResults) {
    const { y0, y1, index, total, boxes } = strip;
    const stripH = y1 - y0;
    for (const b of boxes || []) {
      const top = b.bbox[1];
      const bottom = b.bbox[3];
      // 画像端でない帯の切れ目に接する box は見切れている可能性が高い。
      // その行は重なりにより隣の帯の内部で完全に検出されるので捨てる。
      if (index > 0 && top <= EDGE_MARGIN) continue;
      if (index < total - 1 && bottom >= stripH - EDGE_MARGIN) continue;
      collected.push({
        text: b.text,
        bbox: [b.bbox[0], b.bbox[1] + y0, b.bbox[2], b.bbox[3] + y0],
        confidence: b.confidence,
      });
    }
  }
  // 帯の重なりで二重検出された box を、確信度の高い方を残して除去する。
  const sorted = collected.slice().sort((p, q) => q.confidence - p.confidence);
  const kept = [];
  for (const b of sorted) {
    if (kept.some((k) => iou(k.bbox, b.bbox) > DEDUPE_IOU)) continue;
    kept.push(b);
  }
  return kept;
}

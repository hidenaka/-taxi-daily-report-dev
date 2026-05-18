// js/ocr/src/preprocess.js
// 営業明細写真の前処理（素のCanvas実装。OpenCV非依存）。
// 生画像canvas → 向き補正（横長なら90°回転）→ グレースケール＋拡大。
//
// 旧版は OpenCV.js（ppu-ocv）で 書類4隅検出・台形補正・傾き補正 も行っていたが、
// OpenCV.js は ~8MB＋WASMヒープを消費し iOS Safari がメモリクラッシュした。
// 軽量化のため OpenCV を全廃し、書類検出・台形補正・deskew は除外した。
// 固定テンプレート復元は「概ね正立した写真」を前提とする。

// 横長画像は縦長になるよう反時計回り90°回転する（営業明細は縦長）。
function orient(canvas) {
  if (canvas.width <= canvas.height) return canvas;
  const off = document.createElement("canvas");
  off.width = canvas.height;
  off.height = canvas.width;
  const ctx = off.getContext("2d");
  // 「左に90°回す」標準手順: translate(0,height) してから -90° 回転。
  ctx.translate(0, off.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return off;
}

// グレースケール化し、OCR検出に十分な解像度へ拡大する（目標幅3200px）。
// 注: 適応的二値化は Phase 1A で PP-OCR 精度を落としたため不採用。
function grayscaleResize(canvas) {
  // iOS Safari の canvas 面積上限（約16.7Mpx）を超えるとクラッシュするため、
  // 目標幅は面積が約16Mpx を超えない範囲に収める。
  const MAX_AREA = 16_000_000;
  let targetW = 3200;
  let h = Math.round(canvas.height * (targetW / canvas.width));
  if (targetW * h > MAX_AREA) {
    targetW = Math.floor(Math.sqrt((MAX_AREA * canvas.width) / canvas.height));
    h = Math.round(canvas.height * (targetW / canvas.width));
  }
  const off = document.createElement("canvas");
  off.width = targetW;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, targetW, h);
  // グレースケール化（輝度＝0.299R+0.587G+0.114B）。
  const img = ctx.getImageData(0, 0, targetW, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return off;
}

/**
 * 生画像canvasを前処理し、OCR投入可能なcanvasを返す。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function preprocessImage(canvas) {
  return grayscaleResize(orient(canvas));
}

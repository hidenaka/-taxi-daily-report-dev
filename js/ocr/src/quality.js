// js/ocr/src/quality.js
// 撮影画像のブレ・ピンボケ判定（素のCanvas実装。OpenCV非依存）。
// グレースケール画像に Laplacian を畳み込み、その分散が低いほど不鮮明。
// 旧版は OpenCV.js（ppu-ocv）を使っていたが、iOS Safari のメモリ対策で除去した。

// canvas を縮小したグレースケール輝度配列に変換する。
// ブレ判定は低解像度でも十分判定できるため、メモリ削減のため最大1024pxへ縮小する。
function toGrayDownscaled(canvas, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float64Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, w, h };
}

/**
 * 画像のブレ度合いを判定する。
 * 4近傍 Laplacian（中心×4 − 上下左右）の分散を求める。鮮明な書類写真は
 * 文字エッジが多く分散が大きい。閾値は「ほぼ一様＝完全なボケ」だけを弾く
 * 緩めの値にしてある（誤って良い写真を弾くより、ボケはOCR失敗側で拾う）。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {number} threshold variance がこれ未満なら不鮮明とみなす（既定6・縮小1024px基準）
 * @returns {Promise<{variance:number, blurry:boolean}>}
 */
export async function checkBlur(canvas, threshold = 6) {
  const { gray, w, h } = toGrayDownscaled(canvas);
  if (w < 3 || h < 3) return { variance: 0, blurry: true };
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i] * 4 - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return { variance, blurry: variance < threshold };
}

// QR コード生成ラッパー（招待URL/紹介URL用）。
// 採用ライブラリ: qrcode-generator (kazuhikoarase/qrcode-generator, MIT)
// CDN 動的読込（admin/settings の限定UIでのみ使うため PWA precache 不要）。
//
// 使い方:
//   const svg = await renderQrSvg('https://example.com', { cellSize: 4 });
//   container.innerHTML = svg;
//
// PNG ダウンロード:
//   const blob = await renderQrPngBlob(text, { cellSize: 8 });
//   const url = URL.createObjectURL(blob);
//   const a = document.createElement('a'); a.href = url; a.download = 'qr.png'; a.click();

const CDN_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

let qrLibPromise = null;

// CDN を動的読込（global の `qrcode` を返す）。1回のみ読込・並列呼び出しでも共有。
function loadQrLib() {
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise((resolve, reject) => {
    if (typeof window.qrcode === 'function') return resolve(window.qrcode);
    const script = document.createElement('script');
    script.src = CDN_URL;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (typeof window.qrcode === 'function') resolve(window.qrcode);
      else reject(new Error('qrcode-generator failed to load'));
    };
    script.onerror = () => reject(new Error('qrcode-generator script error'));
    document.head.appendChild(script);
  });
  return qrLibPromise;
}

// SVG 文字列で QR コードを返す。
// text: 埋め込む文字列（URL等）
// opts.cellSize: 1セルのピクセル数（デフォルト 4）
// opts.margin: 周囲の余白（セル数、デフォルト 4）
// opts.typeNumber: QR バージョン（0=自動）
// opts.errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'（デフォルト 'M'）
export async function renderQrSvg(text, opts = {}) {
  const qrcode = await loadQrLib();
  const cellSize = opts.cellSize || 4;
  const margin = opts.margin != null ? opts.margin : 4;
  const qr = qrcode(opts.typeNumber || 0, opts.errorCorrectionLevel || 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

// PNG Blob を返す（ダウンロード用）。
// canvas に描画 → toBlob で PNG 化。
export async function renderQrPngBlob(text, opts = {}) {
  const qrcode = await loadQrLib();
  const cellSize = opts.cellSize || 8;
  const margin = opts.margin != null ? opts.margin : 4;
  const qr = qrcode(opts.typeNumber || 0, opts.errorCorrectionLevel || 'M');
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const size = (modules + margin * 2) * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect((col + margin) * cellSize, (row + margin) * cellSize, cellSize, cellSize);
      }
    }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

// ヘルパー: PNG をブラウザでダウンロードする。
export async function downloadQrPng(text, filename = 'invite-qr.png', opts = {}) {
  const blob = await renderQrPngBlob(text, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

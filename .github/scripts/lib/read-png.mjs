// 依存なしで PNG を読む（地理院の標高タイル用。8bit の RGB・RGBA・パレットだけ）
import { inflateSync } from 'node:zlib';

export function readPng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('PNG ではありません');
  let o = 8; let w = 0; let h = 0; let depth = 0; let type = 0; let plte = null;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const kind = buf.toString('latin1', o + 4, o + 8);
    const d = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error('インターレースは読めません'); }
    else if (kind === 'PLTE') plte = d;
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || ![2, 3, 6].includes(type)) throw new Error(`読めない PNG（depth ${depth} type ${type}）`);
  const bpp = type === 2 ? 3 : type === 6 ? 4 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return {
    width: w, height: h,
    rgb(x, y) {
      const i = y * stride + x * bpp;
      if (type === 3) { const k = px[i] * 3; return [plte[k], plte[k + 1], plte[k + 2]]; }
      return [px[i], px[i + 1], px[i + 2]];
    },
  };
}

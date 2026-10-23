// .github/scripts/lib/read-zip.mjs — 依存なしで ZIP の中身を読む（開発時の変換スクリプト用）
//
// 警視庁の CSV 一式 ZIP は、ファイル名が CP932（Shift_JIS）で入っている（UTF-8 の印が無い）。
// 印が無いファイル名は CP932 として読み、印があるものは UTF-8 として読む。
import { inflateRawSync } from 'node:zlib';

const sjis = new TextDecoder('shift_jis');
const utf8 = new TextDecoder('utf-8');

/** ZIP のバイト列 → [{ name, data(Buffer) }]（ディレクトリは除く・ZIP 内の並び順） */
export function readZip(buf) {
  // 中央ディレクトリの終わり（EOCD）を後ろから探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP の終わりの印が見つかりません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP の目次が壊れています');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? utf8 : sjis).decode(rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = inflateRawSync(body);
    else throw new Error(`未対応の圧縮方式 ${method}: ${name}`);
    out.push({ name, data });
  }
  return out;
}

/** CP932 のバイト列を文字列に */
export const decodeCp932 = (b) => sjis.decode(b);

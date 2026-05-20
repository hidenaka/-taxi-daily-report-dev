// worker/src/setup-request/token.js — 招待トークン生成・hash 化（純関数）
// Node.js (テスト時) と Cloudflare Workers (本番時) の両方で動く Web Crypto を使う。

const TOKEN_BYTES = 32; // 32 bytes -> 64 hex chars

export function generateToken() {
  const buf = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(String(token));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

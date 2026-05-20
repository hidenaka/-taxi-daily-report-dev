// worker/src/auth/verify-id-token.js
// Firebase Auth ID Token 検証 (Worker 用)
//
// 流れ:
//   1. Authorization: Bearer <id_token> から JWT を取り出す
//   2. Google の公開 JWKs を取得（kid で対応する鍵を選ぶ）
//   3. RS256 で署名検証
//   4. payload の aud (=FIREBASE_PROJECT_ID), iss (=https://securetoken.google.com/<project>),
//      exp (未来) を検証
//   5. payload.sub (=UID) を返す
//
// 公開 JWKs は isolate 内でキャッシュ（24時間）。

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let jwksCache = null; // { keys, fetchedAt }
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

export function parseJwtUnsafe(jwt) {
  try {
    if (typeof jwt !== 'string') return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { header, payload, signaturePart: parts[2], headerB64: parts[0], payloadB64: parts[1] };
  } catch {
    return null;
  }
}

export function isAdminUid(uid, adminUids) {
  if (!Array.isArray(adminUids)) return false;
  if (!uid) return false;
  return adminUids.includes(uid);
}

export async function verifyFirebaseIdToken(idToken, projectId) {
  const parsed = parseJwtUnsafe(idToken);
  if (!parsed) throw new Error('invalid_token');
  const { header, payload } = parsed;
  if (header.alg !== 'RS256') throw new Error('alg_unsupported');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expired');
  if (payload.aud !== projectId) throw new Error('aud_mismatch');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss_mismatch');
  if (!payload.sub) throw new Error('no_sub');

  const jwks = await getJwks();
  const cert = jwks[header.kid];
  if (!cert) throw new Error('kid_not_found');

  const key = await importX509(cert);
  const data = new TextEncoder().encode(parsed.headerB64 + '.' + parsed.payloadB64);
  const sig = base64UrlToBytes(parsed.signaturePart);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, sig, data,
  );
  if (!ok) throw new Error('signature_invalid');
  return { uid: payload.sub };
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && (now - jwksCache.fetchedAt) < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const keys = await res.json();
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

async function importX509(certPem) {
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const spki = extractSpkiFromCertificate(der);
  return crypto.subtle.importKey(
    'spki', spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
}

// 簡易 ASN.1 パーサで X.509 証明書から SubjectPublicKeyInfo (SPKI) を抽出する。
function extractSpkiFromCertificate(certDer) {
  function readLen(b, p) {
    let len = b[p++]; if (len & 0x80) {
      const n = len & 0x7f; len = 0;
      for (let j = 0; j < n; j++) len = (len << 8) | b[p++];
    }
    return { len, p };
  }
  function skip(b, p) {
    p++; // tag
    const { len, p: p2 } = readLen(b, p);
    return p2 + len;
  }
  function descend(b, p) {
    p++; // SEQUENCE tag
    const { p: p2 } = readLen(b, p);
    return p2;
  }
  let i = descend(certDer, 0); // outer SEQUENCE
  const tbsStart = i;
  i++; // tag
  const { len: tbsLen, p: tbsContentStart } = readLen(certDer, i);
  const tbsEnd = tbsContentStart + tbsLen;
  i = tbsContentStart;
  // skip: version [0] explicit, serialNumber INTEGER, signature SEQUENCE,
  //       issuer SEQUENCE, validity SEQUENCE, subject SEQUENCE
  let skipped = 0;
  while (skipped < 6 && i < tbsEnd) {
    i = skip(certDer, i);
    skipped++;
  }
  // 現在位置が SubjectPublicKeyInfo の先頭
  const spkiStart = i;
  i++; // tag
  const { len: spkiLen, p: spkiContentStart } = readLen(certDer, i);
  void spkiLen; void spkiContentStart;
  // SubjectPublicKeyInfo の全体（タグ＋長さ＋中身）を返す
  return certDer.slice(spkiStart, spkiContentStart + spkiLen);
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const bin = atob(b64 + '='.repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

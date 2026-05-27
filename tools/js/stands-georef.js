// tools/js/stands-georef.js — PDF px → 緯度経度 のホモグラフィ計算（純関数）
// 外部ライブラリ依存ゼロ。最小二乗法で 3x3 行列を解く。
//   pdf(x,y) → geo(lng,lat) の対応点ペアから H を求め、任意の点を変換する。

function solveDLT(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const A = [], b = [];
  for (const p of pairs) {
    const x = p.pdf.x, y = p.pdf.y;
    const X = p.geo.lng, Y = p.geo.lat;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const AT = transpose(A);
  const ATA = matMul(AT, A);
  const ATb = matVec(AT, b);
  const h = solveLinear(ATA, ATb);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

function isDegenerate(pairs) {
  if (pairs.length < 3) return true;
  const a = pairs[0].pdf, b = pairs[1].pdf, c = pairs[2].pdf;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return area < 1e-6;
}

export function computeHomography(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 3) return null;
  if (isDegenerate(pairs)) return null;
  try {
    return solveDLT(pairs);
  } catch (e) {
    return null;
  }
}

export function applyHomography(H, points) {
  if (!H || !Array.isArray(points)) return [];
  return points.map((p) => {
    const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
    const X = (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w;
    const Y = (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w;
    return { lat: Y, lng: X };
  });
}

export function applyToPdfLines(H, pdfLines) {
  return applyHomography(H, pdfLines || []);
}

function transpose(M) {
  const r = M.length, c = M[0].length;
  const T = Array.from({ length: c }, () => new Array(r));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j];
  return T;
}

function matMul(A, B) {
  const r = A.length, k = A[0].length, c = B[0].length;
  const C = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    let s = 0;
    for (let m = 0; m < k; m++) s += A[i][m] * B[m][j];
    C[i][j] = s;
  }
  return C;
}

function matVec(A, v) {
  const r = A.length, c = A[0].length;
  const out = new Array(r).fill(0);
  for (let i = 0; i < r; i++) {
    let s = 0;
    for (let j = 0; j < c; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    if (Math.abs(M[maxRow][i]) < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    const piv = M[i][i];
    for (let j = i; j <= n; j++) M[i][j] /= piv;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row[n]);
}

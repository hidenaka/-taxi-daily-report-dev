// scripts/apply-georef-batch.mjs — 全自動ジオリファレンス
// 各施設の referencePoints (PDFpx⇔緯度経度の3-4点)からホモグラフィを計算し、
// pdfLines を地図上の進入線(approaches[].line)に変換する。
// ユーザー操作ゼロ。データだけで完結。
import { readFileSync, writeFileSync } from 'node:fs';
import { computeHomography, applyToPdfLines } from '../tools/js/stands-georef.js';

const SEED = 'scripts/data/stands-seed-keiho.json';
const PDF = 'scripts/data/pdf-lines-keiho.json';

const stands = JSON.parse(readFileSync(SEED, 'utf8'));
const pdf = JSON.parse(readFileSync(PDF, 'utf8'));

let ok = 0; const skipped = [];
for (const s of stands) {
  const entry = pdf[s.id];
  if (!entry || !Array.isArray(entry.referencePoints) || entry.referencePoints.length < 3) {
    skipped.push(`${s.id}: referencePoints 不足`);
    continue;
  }
  if (!Array.isArray(entry.approaches) || entry.approaches.length === 0) {
    skipped.push(`${s.id}: approaches 不足`);
    continue;
  }
  if (!Array.isArray(s.approaches) || s.approaches.length === 0) {
    skipped.push(`${s.id}: seed approaches なし`);
    continue;
  }

  const pairs = entry.referencePoints.map((rp) => ({ pdf: rp.pdf, geo: rp.geo }));
  const H = computeHomography(pairs);
  if (!H) { skipped.push(`${s.id}: ホモグラフィ計算失敗`); continue; }

  let appliedCount = 0;
  entry.approaches.forEach((ap, i) => {
    if (i >= s.approaches.length) return;
    if (!Array.isArray(ap.pdfLines) || ap.pdfLines.length < 2) return;
    s.approaches[i].pdfImageRef = ap.pdfImageRef || '';
    s.approaches[i].pdfLines = ap.pdfLines.slice();
    const line = applyToPdfLines(H, ap.pdfLines);
    if (line.length >= 2) {
      s.approaches[i].line = line;
      appliedCount += 1;
    }
  });
  if (appliedCount > 0) { ok += 1; console.log(`✓ ${s.id}: ${appliedCount}本の線を変換`); }
  else { skipped.push(`${s.id}: pdfLines 不足`); }
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
console.log(`\n結果: ${ok} 施設で進入線を自動変換`);
if (skipped.length) {
  console.log('スキップ:');
  for (const w of skipped) console.log('  ' + w);
}

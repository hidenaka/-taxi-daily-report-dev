// scripts/merge-pdf-lines.mjs — pdf-lines-keiho.json を seed JSON の approaches に取り込む
// 各施設の approaches[index] に pdfImageRef と pdfLines を追加。
// approaches がない/不足している施設は警告のみ（変更しない）。
import { readFileSync, writeFileSync } from 'node:fs';

const SEED = 'scripts/data/stands-seed-keiho.json';
const PDF = 'scripts/data/pdf-lines-keiho.json';

const stands = JSON.parse(readFileSync(SEED, 'utf8'));
const pdf = JSON.parse(readFileSync(PDF, 'utf8'));

let merged = 0; const warnings = [];
for (const s of stands) {
  const entry = pdf[s.id];
  if (!entry || !Array.isArray(entry.approaches)) continue;
  if (!Array.isArray(s.approaches) || s.approaches.length === 0) {
    warnings.push(`${s.id}: seed JSON に approaches 無し（先に merge-approaches を実行）`);
    continue;
  }
  entry.approaches.forEach((p, i) => {
    if (i >= s.approaches.length) {
      warnings.push(`${s.id}: pdf.approaches[${i}] に対応する seed approach なし`);
      return;
    }
    s.approaches[i].pdfImageRef = p.pdfImageRef || '';
    s.approaches[i].pdfLines = Array.isArray(p.pdfLines)
      ? p.pdfLines.filter((q) => typeof q.x === 'number' && typeof q.y === 'number')
                  .map((q) => ({ x: q.x, y: q.y }))
      : [];
  });
  merged += 1;
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
console.log(`pdfLines マージ: ${merged} 施設`);
if (warnings.length) {
  console.log('警告:');
  for (const w of warnings) console.log('  ' + w);
}

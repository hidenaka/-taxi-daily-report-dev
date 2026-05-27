// scripts/merge-approaches.mjs — approaches-keiho.json を seed JSON にマージ
// ・各施設に approaches[] と cautions[] を追加
// ・旧 markers/routes/overlay は除去（approaches に一本化）
import { readFileSync, writeFileSync } from 'node:fs';

const SEED = 'scripts/data/stands-seed-keiho.json';
const APP  = 'scripts/data/approaches-keiho.json';

const stands = JSON.parse(readFileSync(SEED, 'utf8'));
const app = JSON.parse(readFileSync(APP, 'utf8'));

let merged = 0; const missing = [];
for (const s of stands) {
  const a = app[s.id];
  if (a && Array.isArray(a.approaches) && a.approaches.length) {
    s.approaches = a.approaches.map((ap) => ({
      label: ap.label || '',
      road: ap.road || '',
      bearing: typeof ap.bearing === 'number' ? ap.bearing : null,
      turn: ap.turn || 'either',
      hint: ap.hint || '',
      line: Array.isArray(ap.line) ? ap.line.map((p) => ({ lat: p[0], lng: p[1] })) : [],
    }));
    s.cautions = Array.isArray(a.cautions) ? a.cautions.slice() : [];
    delete s.markers;
    delete s.routes;
    delete s.overlay;
    merged += 1;
  } else {
    missing.push(s.id);
  }
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
console.log(`approaches マージ: ${merged} 施設`);
if (missing.length) console.log('approaches なし:', missing.join(', '));

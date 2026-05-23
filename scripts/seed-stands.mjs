// scripts/seed-stands.mjs — companies/{companyId}/stands を firebase-admin でシード
// 使い方:
//   GOOGLE_APPLICATION_CREDENTIALS=<dev SA鍵> \
//   node scripts/seed-stands.mjs --project taxi-dailydata-dev --company co-7q7ros --file scripts/data/stands-seed-sample.json
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const projectId = arg('project', 'taxi-dailydata-dev');
const companyId = arg('company');
const file = arg('file', 'scripts/data/stands-seed-sample.json');
const dryRun = process.argv.includes('--dry-run');

if (!companyId) { console.error('--company <slug> が必須'); process.exit(1); }

const items = JSON.parse(readFileSync(file, 'utf8'));
console.log(`project=${projectId} company=${companyId} 件数=${items.length} dryRun=${dryRun}`);

if (!dryRun) admin.initializeApp({ projectId });
const db = dryRun ? null : admin.firestore();

for (const s of items) {
  const id = s.id;
  const { id: _omit, ...data } = s;
  if (dryRun) { console.log('would write', id, data.name); continue; }
  const doc = { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'seed-script' };
  await db.collection('companies').doc(companyId).collection('stands').doc(id).set(doc);
  console.log('wrote', id, data.name);
}
console.log('done');
process.exit(0);

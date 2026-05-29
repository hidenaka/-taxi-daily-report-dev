// userConfigs/{userId}.rateTable を「会社doc(正本)の rateTable」に揃える。
// rateTable フィールドだけ置換し他フィールドは温存。payrollMode==='fixed_rate' はスキップ。
// 正本=companies/{slug}.rateTable（dev=co-7q7ros / 本番=co-swyg3o。DEFAULT_CONFIG・2025/10シートと一致確認済）。
// 使い方:
//   node update-userconfig-rate-tables.mjs --project=taxi-dailydata-dev --dry-run
//   node update-userconfig-rate-tables.mjs --project=taxi-dailydata-dev --execute
//   node update-userconfig-rate-tables.mjs --project=taxi-dailydata --dry-run   # 本番
//   node update-userconfig-rate-tables.mjs --project=taxi-dailydata --execute
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const projectId = (args.find(a => a.startsWith('--project=')) || '--project=taxi-dailydata-dev').split('=')[1];
const isExecute = args.includes('--execute');
const slugArg = args.find(a => a.startsWith('--slug='));
const slug = slugArg ? slugArg.split('=')[1] : (projectId === 'taxi-dailydata' ? 'co-swyg3o' : 'co-7q7ros');

// キー順に依存しない正規化stringify（Firestoreはmap/objectのキー順を変えて返すため）
const stable = (v) => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
};

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

const compSnap = await db.collection('companies').doc(slug).get();
if (!compSnap.exists || !compSnap.data().rateTable) {
  console.error(`正本が取れません: companies/${slug}.rateTable`);
  process.exit(1);
}
const canonical = compSnap.data().rateTable;
const canonicalStr = stable(canonical);

console.log(`Project: ${projectId}`);
console.log(`正本:    companies/${slug}.rateTable (keys=${Object.keys(canonical).join(',')})`);
console.log(`Mode:    ${isExecute ? 'EXECUTE' : 'DRY-RUN (読み取りのみ)'}`);
console.log('');

const snap = await db.collection('userConfigs').get();
const toUpdate = [];
let alreadyOk = 0, noTable = 0, skippedFixed = 0;
for (const d of snap.docs) {
  const data = d.data();
  if (data.payrollMode === 'fixed_rate') { skippedFixed++; continue; }
  if (!data.rateTable) { noTable++; continue; }
  if (stable(data.rateTable) === canonicalStr) { alreadyOk++; continue; }
  toUpdate.push(d.id);
}
console.log(`userConfigs 総数: ${snap.size}`);
console.log(`  既に正本一致: ${alreadyOk} / rateTable無し: ${noTable} / fixed_rate: ${skippedFixed}`);
console.log(`  → 要更新: ${toUpdate.length} 件`);
console.log(`     ${toUpdate.join(', ')}`);
console.log('');

if (!isExecute) { console.log('(dry-run: 書き込みなし。--execute で会社docの表に置換)'); process.exit(0); }

let done = 0;
for (const id of toUpdate) {
  await db.collection('userConfigs').doc(id).update({ rateTable: canonical });
  console.log(`  ✓ ${id} (${++done}/${toUpdate.length})`);
}
console.log(`\n✅ ${done} 件を正本に揃えました。`);
process.exit(0);

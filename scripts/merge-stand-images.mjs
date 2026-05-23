// scripts/merge-stand-images.mjs — stands-ref/ の画像を seed JSON に images として取り込む（一度きり）
// ・各standに images=[<id>-N.jpg...] を付与
// ・画像方式に統一するため markers/routes は除去
// ・PDFのみ存在しmanualに無い2施設(アメリカンクラブ/パークハイアット)を追加
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const SEED = 'scripts/data/stands-seed-keiho.json';
const REFDIR = 'tools/data/stands-ref';

const stands = JSON.parse(readFileSync(SEED, 'utf8'));

// id -> [files] を実ファイル走査で構築
const byId = {};
for (const f of readdirSync(REFDIR)) {
  const m = f.match(/^(.+)-(\d+)\.jpg$/);
  if (!m) continue;
  (byId[m[1]] ||= []).push({ n: Number(m[2]), f });
}
for (const id of Object.keys(byId)) byId[id] = byId[id].sort((a, b) => a.n - b.n).map((x) => x.f);

// 既存standにimages付与＋markers/routes除去
for (const s of stands) {
  delete s.markers;
  delete s.routes;
  if (byId[s.id]) s.images = byId[s.id];
  else if (!s.images) s.images = [];
}

// 新規2施設（manual外・PDFのみ）。pinは概略。
const existing = new Set(stands.map((s) => s.id));
const extras = [
  { id: 'tokyo_american_club', name: '東京アメリカンクラブ', category: 'other',
    pin: { lat: 35.6588, lng: 139.7402 },
    notes: '（マニュアル記載なし）道順図を参照。', sourcePdf: '18東京アメリカンクラブ.pdf' },
  { id: 'park_hyatt_tokyo', name: 'パークハイアット東京', category: 'hotel',
    pin: { lat: 35.6856, lng: 139.6906 },
    notes: '（マニュアル記載なし）道順図を参照。', sourcePdf: '43パークハイアット東京.pdf' },
];
for (const e of extras) {
  if (existing.has(e.id)) continue;
  e.images = byId[e.id] || [];
  stands.push(e);
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
const withImg = stands.filter((s) => s.images && s.images.length).length;
console.log(`stands=${stands.length} 画像付き=${withImg} 画像なし=${stands.length - withImg}`);
console.log('画像なし:', stands.filter((s) => !s.images || !s.images.length).map((s) => s.id).join(', '));

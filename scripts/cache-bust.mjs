// デプロイ時キャッシュバスティング（本番 deploy.yml から呼ぶ）。
//
// 目的: index.html(短命キャッシュ) は即更新されるのに tools/js/*.js 等が
// Cloudflare で最大4時間キャッシュされるため、デプロイ直後に「新HTML＋古JS」の
// 組合せになり ESM import が失敗してタイマー等が丸ごと停止する版ズレを恒久的に防ぐ。
//
// 仕組み: ローカル .js 参照（HTMLの from/import/src、sw.js の precache）に
// `?b=<token>` を付与。token はデプロイ毎に変わるコミットSHA等。URLが毎回変わるので
// 4時間キャッシュを確実に貫通し、新HTMLは必ず同デプロイの新JSを取りに行く。
//
// 性質: 冪等（既に ?付きは触らない）/ 外部URL(http) は対象外 / 失敗時は何も変えない。
// 使い方: node scripts/cache-bust.mjs <root-dir> <token>

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const token = String(process.argv[3] || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
if (!root || !token) {
  console.error('usage: node scripts/cache-bust.mjs <root-dir> <token>');
  process.exit(1);
}

// ローカル .js か（http/プロトコル相対/既存クエリは除外）
const isLocalJs = (p) => /\.js$/.test(p) && !/^https?:/i.test(p) && !p.startsWith('//') && !p.includes('?');

// HTML: from '...'/import '...'/src="..." の local .js にだけクエリ付与
function bustHtml(src) {
  return src.replace(
    /\b(from|import|src)(\s*=?\s*)(['"])([^'"]+?\.js)(\3)/g,
    (m, kw, mid, q, path) => (isLocalJs(path) ? `${kw}${mid}${q}${path}?b=${token}${q}` : m)
  );
}
// sw.js: precache 配列の './....js' リテラルにだけクエリ付与（先頭 ./ のみ＝ローカル）
function bustSw(src) {
  return src.replace(
    /(['"])(\.\/[^'"]+?\.js)\1/g,
    (m, q, path) => (isLocalJs(path) ? `${q}${path}?b=${token}${q}` : m)
  );
}

function walk(dir, cb) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

let changed = 0;
walk(root, (file) => {
  let transform = null;
  if (file.endsWith('.html')) transform = bustHtml;
  else if (file.endsWith('sw.js')) transform = bustSw;
  if (!transform) return;
  const s = readFileSync(file, 'utf8');
  const o = transform(s);
  if (o !== s) { writeFileSync(file, o); changed++; }
});
console.log(`cache-bust: token=${token} files_changed=${changed}`);

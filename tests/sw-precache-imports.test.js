import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 目的: HTML が静的 import する ./js/*.js は、すべて sw.js の STATIC_FILES に
// 登録されていなければならない。未登録だと SW キャッシュ bump 後（旧キャッシュ削除後）の
// オフライン/不安定回線で import が解決できず、モジュール全体が落ちて画面が壊れる
// （実例: settings.html が admin-companies.js を未登録のまま import → 下部ナビが消えた）。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function listHtml() {
  const out = [];
  for (const f of readdirSync(ROOT)) if (f.endsWith('.html')) out.push(f);
  try { for (const f of readdirSync(join(ROOT, 'tools'))) if (f.endsWith('.html')) out.push(join('tools', f)); } catch {}
  return out;
}

// HTML から静的 import される ./js/X.js を抽出（`from '...'` と 副作用 import の両形式）。
// tools/ サブディレクトリの HTML で ./js/X.js を import する場合は tools/js/ 相対となるため、
// sw.js での登録パス（./tools/js/X.js）に正規化して返す。
function staticJsImports(html) {
  const src = readFileSync(join(ROOT, html), 'utf8');
  const htmlDir = html.includes('/') ? html.slice(0, html.lastIndexOf('/') + 1) : '';
  const set = new Set();
  const re = /(?:from|import)\s*['"](\.\/js\/[a-zA-Z0-9_-]+\.js)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    // ./js/X.js を HTML の位置を考慮してリポジトリルート相対パスに正規化する
    // 例: tools/index.html + ./js/countdown.js → ./tools/js/countdown.js
    const normalized = htmlDir ? `./${htmlDir}${m[1].slice(2)}` : m[1];
    set.add(normalized);
  }
  return set;
}

function staticFilesInSw() {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const set = new Set();
  const re = /['"](\.\/(?:[a-zA-Z0-9_-]+\/)*js\/[a-zA-Z0-9_-]+\.js)['"]/g;
  let m;
  while ((m = re.exec(sw))) set.add(m[1]);
  return set;
}

test('HTML が静的 import する全 ./js/*.js は sw.js STATIC_FILES に登録済み', () => {
  const registered = staticFilesInSw();
  const missing = [];
  for (const html of listHtml()) {
    for (const imp of staticJsImports(html)) {
      if (!registered.has(imp)) missing.push(`${html} → ${imp}`);
    }
  }
  assert.deepEqual(
    missing, [],
    `SW未登録の静的importがあります（オフラインで画面が壊れる）:\n  ${missing.join('\n  ')}`
  );
});

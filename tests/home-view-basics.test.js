// ホーム画面の表示まわりの回帰テスト（HTML を直接検査する軽量版）。
//
// 1. ピンチズーム: viewport の maximum-scale=1 が拡大を禁止していた（2026-08-06 報告）。
//    文字が小さくて拡大したい場面があるので、ホームでは拡大できるようにする。
// 2. 概算バッジ: 「合計のみ（概算）」で入れた乗務が売上に混ざっていることを
//    画面で分かるようにする。
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

// リポジトリ内の全 HTML を集める（node_modules は除く）
function allHtmlFiles(dir = ROOT, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) allHtmlFiles(full, acc);
    else if (e.name.endsWith('.html')) acc.push(path.relative(ROOT, full));
  }
  return acc;
}

test('全ページが指でつまんで拡大できる（viewport が拡大を禁止していない）', () => {
  const files = allHtmlFiles();
  assert.ok(files.length >= 20, `HTML が集まる: ${files.length}件`);
  const blocked = [];
  for (const f of files) {
    const m = html(f).match(/<meta name="viewport" content="([^"]+)"/);
    if (!m) continue; // viewport 指定なしのページは対象外
    const content = m[1];
    if (/maximum-scale\s*=/.test(content) || /user-scalable\s*=\s*(no|0)/.test(content)) {
      blocked.push(`${f}: ${content}`);
    }
    assert.ok(/width=device-width/.test(content), `${f} は端末幅のまま: ${content}`);
  }
  assert.deepEqual(blocked, [], '拡大を禁止しているページが無い');
});

test('ノッチ対応(viewport-fit=cover)を消していない', () => {
  const withFit = allHtmlFiles().filter(f => /viewport-fit=cover/.test(html(f)));
  assert.ok(withFit.length >= 5, `viewport-fit=cover が残っている: ${withFit.length}件`);
});

test('ホームに「概算を含む」表示のための実装がある', () => {
  const src = html('index.html');
  assert.ok(/approxCount/.test(src), '概算件数を参照している');
  assert.ok(/概算/.test(src), '「概算」の文言がある');
});

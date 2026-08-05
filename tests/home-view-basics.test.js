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

test('ホームは指でつまんで拡大できる（viewport が拡大を禁止していない）', () => {
  const m = html('index.html').match(/<meta name="viewport" content="([^"]+)"/);
  assert.ok(m, 'viewport メタタグがある');
  const content = m[1];
  assert.ok(!/maximum-scale\s*=\s*1\b/.test(content), `拡大を禁止していない: ${content}`);
  assert.ok(!/user-scalable\s*=\s*(no|0)/.test(content), `user-scalable=no が無い: ${content}`);
  assert.ok(/width=device-width/.test(content), '横幅は端末幅のまま');
});

test('ホームに「概算を含む」表示のための実装がある', () => {
  const src = html('index.html');
  assert.ok(/approxCount/.test(src), '概算件数を参照している');
  assert.ok(/概算/.test(src), '「概算」の文言がある');
});

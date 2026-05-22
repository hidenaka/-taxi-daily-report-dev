import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('CACHE_NAME が help-video導入時(v190)以降にbumpされている', () => {
  // SWキャッシュ規約上 CACHE_NAME は毎リリースbumpされるため、特定版に固定せず下限で検証する。
  const m = sw.match(/CACHE_PREFIX \+ 'v(\d+)'/);
  assert.ok(m, 'CACHE_NAME = CACHE_PREFIX + \'vNNN\' 形式');
  assert.ok(Number(m[1]) >= 190, `v190以降であること (実際: v${m && m[1]})`);
});

test('新規JS2本が STATIC_FILES に登録されている', () => {
  assert.ok(sw.includes("'./js/help-video.js'"), 'help-video.js');
  assert.ok(sw.includes("'./js/help-video-registry.js'"), 'help-video-registry.js');
});

test('動画は素通し（キャッシュしない）ルールがある', () => {
  assert.ok(/mp4/.test(sw), '動画拡張子の分岐');
});

test('使い方動画のサムネ(media/help/)も素通し対象', () => {
  assert.ok(sw.includes('/media/help/'), 'media/help/ の素通しルール');
});

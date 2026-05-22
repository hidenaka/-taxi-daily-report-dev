import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('CACHE_NAME が v183 にbumpされている', () => {
  assert.ok(sw.includes("CACHE_PREFIX + 'v183'"), 'v183 へ bump');
});

test('新規JS2本が STATIC_FILES に登録されている', () => {
  assert.ok(sw.includes("'./js/help-video.js'"), 'help-video.js');
  assert.ok(sw.includes("'./js/help-video-registry.js'"), 'help-video-registry.js');
});

test('動画は素通し（キャッシュしない）ルールがある', () => {
  assert.ok(/mp4/.test(sw), '動画拡張子の分岐');
});

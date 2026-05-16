import { test, assert } from './run.js';
import {
  SUB_CACHE_TTL_MS, isSubCacheFresh, readSubCache, writeSubCache, clearSubCache,
} from '../js/sub-cache.js';

// Node には sessionStorage が無いため簡易モックを用意（read/write/clear の検証用）
globalThis.sessionStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _reset: () => { store = {}; },
  };
})();

test('isSubCacheFresh: null・不正エントリは false', () => {
  const now = Date.now();
  assert.equal(isSubCacheFresh(null, now), false);
  assert.equal(isSubCacheFresh({}, now), false);
  assert.equal(isSubCacheFresh({ v: 1 }, now), false); // cachedAt 無し
  assert.equal(isSubCacheFresh({ v: 2, cachedAt: now }, now), false); // 版数違い
});

test('isSubCacheFresh: TTL 内は true、超過は false', () => {
  const now = 1_000_000_000_000;
  assert.equal(isSubCacheFresh({ v: 1, cachedAt: now - 1000 }, now), true);
  assert.equal(isSubCacheFresh({ v: 1, cachedAt: now - (SUB_CACHE_TTL_MS - 1) }, now), true);
  assert.equal(isSubCacheFresh({ v: 1, cachedAt: now - SUB_CACHE_TTL_MS }, now), false);
  assert.equal(isSubCacheFresh({ v: 1, cachedAt: now - SUB_CACHE_TTL_MS * 2 }, now), false);
});

test('write→read ラウンドトリップ: userId と sub が保存・取得できる', () => {
  sessionStorage._reset();
  writeSubCache('user_x', { status: 'active' });
  const e = readSubCache();
  assert.equal(e.v, 1);
  assert.equal(e.userId, 'user_x');
  assert.deepEqual(e.sub, { status: 'active' });
  assert.equal(typeof e.cachedAt, 'number');
});

test('writeSubCache: sub=null（未申込ユーザー）も保存できる', () => {
  sessionStorage._reset();
  writeSubCache('u', null);
  const e = readSubCache();
  assert.equal(e.sub, null);
  assert.equal(e.userId, 'u');
});

test('readSubCache: 破損JSONは null（＝キャッシュミス扱い）', () => {
  sessionStorage._reset();
  sessionStorage.setItem('taxi_sub_cache_v1', '{壊れた');
  assert.equal(readSubCache(), null);
});

test('clearSubCache: 削除後は null', () => {
  sessionStorage._reset();
  writeSubCache('u', { status: 'trial' });
  assert.ok(readSubCache() !== null);
  clearSubCache();
  assert.equal(readSubCache(), null);
});

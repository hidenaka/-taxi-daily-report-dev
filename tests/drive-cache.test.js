import { test } from 'node:test';
import assert from 'node:assert';
import {
  readFresh, writeCache, clearByPrefix,
  userScopedKey, clearDataCaches,
  DRIVES_CACHE_PREFIX, CONFIG_CACHE_PREFIX, LEGACY_CONFIG_CACHE_KEY,
} from '../js/drive-cache.js';

// Map ベースの最小 Storage 実装（localStorage 互換: getItem/setItem/removeItem/length/key）
function makeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    get length() { return m.size; },
    key: i => Array.from(m.keys())[i] ?? null,
    _dump: () => Object.fromEntries(m),
  };
}

test('readFresh: キーが無ければ null', () => {
  const s = makeStorage();
  assert.equal(readFresh(s, 'taxi_config_cache', 300000, 1000), null);
});

test('readFresh: TTL 以内なら data を返す', () => {
  const s = makeStorage();
  writeCache(s, 'k', { a: 1 }, 1000);
  // now=1000+299999 < ttl 300000 → fresh
  assert.deepEqual(readFresh(s, 'k', 300000, 1000 + 299999), { a: 1 });
});

test('readFresh: TTL を超えたら null（期限切れ）', () => {
  const s = makeStorage();
  writeCache(s, 'k', { a: 1 }, 1000);
  // now=1000+300001 > ttl 300000 → 期限切れ
  assert.equal(readFresh(s, 'k', 300000, 1000 + 300001), null);
});

test('readFresh: 壊れた JSON は null（例外を握る）', () => {
  const s = makeStorage({ k: 'not-json{' });
  assert.equal(readFresh(s, 'k', 300000, 1000), null);
});

test('writeCache + readFresh: 配列もラウンドトリップできる', () => {
  const s = makeStorage();
  const drives = [{ date: '2026-05-01' }, { date: '2026-05-02' }];
  writeCache(s, 'taxi_drives_2026-05', drives, 5000);
  assert.deepEqual(readFresh(s, 'taxi_drives_2026-05', 300000, 5000), drives);
});

test('clearByPrefix: 接頭辞一致キーだけ消す（他は残す）', () => {
  const s = makeStorage();
  writeCache(s, 'taxi_drives_2026-04', [1], 1000);
  writeCache(s, 'taxi_drives_2026-05', [2], 1000);
  writeCache(s, 'taxi_config_cache', { x: 1 }, 1000);
  clearByPrefix(s, 'taxi_drives_');
  assert.equal(s.getItem('taxi_drives_2026-04'), null);
  assert.equal(s.getItem('taxi_drives_2026-05'), null);
  assert.notEqual(s.getItem('taxi_config_cache'), null, 'config は残る');
});

test('clearByPrefix: 該当なしでも安全（何も壊さない）', () => {
  const s = makeStorage();
  writeCache(s, 'taxi_config_cache', { x: 1 }, 1000);
  clearByPrefix(s, 'taxi_drives_');
  assert.notEqual(s.getItem('taxi_config_cache'), null);
});

// ── アカウント切替のクロスユーザー漏れ対策（userId 名前空間化）──

test('userScopedKey: userId を含むキーを組み立てる（drives は period 付き）', () => {
  assert.equal(userScopedKey(DRIVES_CACHE_PREFIX, 'mm', '2026-06'), 'taxi_drives_mm_2026-06');
  assert.equal(userScopedKey(CONFIG_CACHE_PREFIX, 'mm'), 'taxi_config_cache_mm');
});

test('userScopedKey: 別ユーザーは必ず別キー（クロスユーザー漏れの構造的防止）', () => {
  const a = userScopedKey(DRIVES_CACHE_PREFIX, 'user_self', '2026-06');
  const b = userScopedKey(DRIVES_CACHE_PREFIX, 'admin', '2026-06');
  const c = userScopedKey(DRIVES_CACHE_PREFIX, 'mm', '2026-06');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

test('userScopedKey: userId 未確定(null/空)は anon にフォールバック', () => {
  assert.equal(userScopedKey(CONFIG_CACHE_PREFIX, null), 'taxi_config_cache_anon');
  assert.equal(userScopedKey(CONFIG_CACHE_PREFIX, ''), 'taxi_config_cache_anon');
});

test('userScopedKey: namespaced キーは clearByPrefix(DRIVES_CACHE_PREFIX) で消える', () => {
  const s = makeStorage();
  const k = userScopedKey(DRIVES_CACHE_PREFIX, 'mm', '2026-06');
  writeCache(s, k, [1], 1000);
  clearByPrefix(s, DRIVES_CACHE_PREFIX);
  assert.equal(s.getItem(k), null);
});

test('clearDataCaches: 全ユーザーの drives/config キャッシュ + 旧キーを一掃する', () => {
  const s = makeStorage();
  writeCache(s, userScopedKey(DRIVES_CACHE_PREFIX, 'user_self', '2026-06'), [1], 1000);
  writeCache(s, userScopedKey(DRIVES_CACHE_PREFIX, 'mm', '2026-06'), [2], 1000);
  writeCache(s, userScopedKey(CONFIG_CACHE_PREFIX, 'user_self'), { x: 1 }, 1000);
  // 旧(非名前空間)キーも残骸として混在し得る
  writeCache(s, 'taxi_drives_2026-06', [9], 1000);
  writeCache(s, LEGACY_CONFIG_CACHE_KEY, { legacy: true }, 1000);
  // 無関係キーは残す
  s.setItem('taxi_user_id', 'mm');

  clearDataCaches(s);

  assert.equal(s.getItem(userScopedKey(DRIVES_CACHE_PREFIX, 'user_self', '2026-06')), null);
  assert.equal(s.getItem(userScopedKey(DRIVES_CACHE_PREFIX, 'mm', '2026-06')), null);
  assert.equal(s.getItem(userScopedKey(CONFIG_CACHE_PREFIX, 'user_self')), null);
  assert.equal(s.getItem('taxi_drives_2026-06'), null, '旧 drives キーも消す');
  assert.equal(s.getItem(LEGACY_CONFIG_CACHE_KEY), null, '旧 config キーも消す');
  assert.equal(s.getItem('taxi_user_id'), 'mm', '無関係キーは残す');
});

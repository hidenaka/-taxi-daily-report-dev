import { test } from 'node:test';
import assert from 'node:assert';
import { readFresh, writeCache, clearByPrefix } from '../js/drive-cache.js';

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

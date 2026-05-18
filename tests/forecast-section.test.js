import { test, assert } from './run.js';
import { loadForecastData } from '../tools/js/forecast-section.js';

// path -> { body } | { status } のマップで fetch をスタブする
function stubFetch(map) {
  return async (path) => {
    const entry = map[path];
    if (!entry) throw new Error('network error');
    if (entry.status && entry.status !== 200) return { ok: false, status: entry.status };
    return { ok: true, status: 200, json: async () => entry.body };
  };
}

test('loadForecastData: 3種すべて成功で全データを返す', async () => {
  const fetchFn = stubFetch({
    'data/stall-ensemble.json': { body: { a: 1 } },
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.deepEqual(r.ensemble, { a: 1 });
  assert.deepEqual(r.forecast, { b: 2 });
  assert.deepEqual(r.patternMatch, { c: 3 });
  assert.deepEqual(r.errors, {});
});

test('loadForecastData: 404 は errors に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({
    'data/stall-ensemble.json': { status: 404 },
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.equal(r.ensemble, null);
  assert.equal(r.errors.ensemble, 'HTTP 404');
  assert.deepEqual(r.forecast, { b: 2 });
});

test('loadForecastData: fetch 例外も errors に記録し他は継続', async () => {
  const fetchFn = stubFetch({
    'data/stall-forecast.json': { body: { b: 2 } },
    'data/stall-pattern-match.json': { body: { c: 3 } },
  });
  const r = await loadForecastData(fetchFn);
  assert.equal(r.ensemble, null);
  assert.equal(r.errors.ensemble, 'network error');
  assert.deepEqual(r.forecast, { b: 2 });
  assert.deepEqual(r.patternMatch, { c: 3 });
});

import { test, assert } from './run.js';
import { aggregateTo15min, loadEnsemble } from '../tools/js/forecast-section.js';

// --- aggregateTo15min: 5分スロット → 15分ビン合算 ---

test('aggregateTo15min: 同一15分内の3スロットを合算する', () => {
  const slots = [
    { slotStart: '11:00', stall1: 10, stall2: 0, stall3: 0, stall4: 5, total: 15 },
    { slotStart: '11:05', stall1: 5, stall2: 5, stall3: 0, stall4: 0, total: 10 },
    { slotStart: '11:10', stall1: 0, stall2: 0, stall3: 0, stall4: 0, total: 0 },
  ];
  const bins = aggregateTo15min(slots);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].label, '11:00-11:15');
  assert.equal(bins[0].stall1, 15);
  assert.equal(bins[0].stall2, 5);
  assert.equal(bins[0].stall3, 0);
  assert.equal(bins[0].stall4, 5);
  assert.equal(bins[0].total, 25);
});

test('aggregateTo15min: 15分境界をまたぐスロットは別ビンになる', () => {
  const slots = [
    { slotStart: '10:55', stall1: 5, stall2: 0, stall3: 0, stall4: 0, total: 5 },
    { slotStart: '11:00', stall1: 10, stall2: 0, stall3: 0, stall4: 0, total: 10 },
    { slotStart: '11:15', stall1: 0, stall2: 0, stall3: 0, stall4: 5, total: 5 },
  ];
  const bins = aggregateTo15min(slots);
  assert.equal(bins.length, 3);
  assert.deepEqual(bins.map(b => b.label), ['10:45-11:00', '11:00-11:15', '11:15-11:30']);
  assert.equal(bins[0].total, 5);
  assert.equal(bins[1].total, 10);
  assert.equal(bins[2].total, 5);
});

test('aggregateTo15min: total は乗り場の合計で再計算する', () => {
  // 入力 total が乗り場合計とずれていても、出力は乗り場合計を優先
  const slots = [
    { slotStart: '12:00', stall1: 3, stall2: 2, stall3: 1, stall4: 4, total: 999 },
  ];
  const bins = aggregateTo15min(slots);
  assert.equal(bins[0].total, 10);
});

test('aggregateTo15min: ビンは時刻昇順に並ぶ', () => {
  const slots = [
    { slotStart: '12:30', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
    { slotStart: '11:00', stall1: 2, stall2: 0, stall3: 0, stall4: 0, total: 2 },
  ];
  const bins = aggregateTo15min(slots);
  assert.deepEqual(bins.map(b => b.label), ['11:00-11:15', '12:30-12:45']);
});

test('aggregateTo15min: 空配列・undefined は空配列を返す', () => {
  assert.deepEqual(aggregateTo15min([]), []);
  assert.deepEqual(aggregateTo15min(undefined), []);
});

// --- loadEnsemble: stall-ensemble.json の取得 ---

function stubFetch(map, calls) {
  return async (path, options) => {
    if (calls) calls.push({ path, options });
    const entry = map[path];
    if (!entry) throw new Error('network error');
    if (entry.status && entry.status !== 200) return { ok: false, status: entry.status };
    return { ok: true, status: 200, json: async () => entry.body };
  };
}

test('loadEnsemble: 成功でデータを返し error は null', async () => {
  const calls = [];
  const fetchFn = stubFetch({ 'data/stall-ensemble.json': { body: { slots: [] } } }, calls);
  const r = await loadEnsemble(fetchFn);
  assert.deepEqual(r.data, { slots: [] });
  assert.equal(r.error, null);
  assert.ok(calls.length === 1 && calls[0].options && calls[0].options.cache === 'no-store',
    'fetch には cache:no-store を渡すこと');
});

test('loadEnsemble: 404 は error に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({ 'data/stall-ensemble.json': { status: 404 } });
  const r = await loadEnsemble(fetchFn);
  assert.equal(r.data, null);
  assert.equal(r.error, 'HTTP 404');
});

test('loadEnsemble: fetch 例外も error に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({});
  const r = await loadEnsemble(fetchFn);
  assert.equal(r.data, null);
  assert.equal(r.error, 'network error');
});

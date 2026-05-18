import { test, assert } from './run.js';
import { aggregateTo15min, loadEnsemble, isStale, loadActuals, renderActualsTable } from '../tools/js/forecast-section.js';

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

test('aggregateTo15min: 入力スロット順を保つ（日跨ぎ 23時台→0時台でも順序が崩れない）', () => {
  // 予測スロットは時系列順に並んだ配列。23:50→0:05 のように日付をまたいでも、
  // 出力ビンは入力の時系列順を保つ（時分だけでソートして 0:00 を先頭に出さない）。
  const slots = [
    { slotStart: '23:50', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
    { slotStart: '23:55', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
    { slotStart: '0:00', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
    { slotStart: '0:05', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
  ];
  const bins = aggregateTo15min(slots);
  assert.deepEqual(bins.map(b => b.label), ['23:45-0:00', '0:00-0:15']);
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

// --- isStale: 古い予測データの判定 ---

test('isStale: 閾値以内の新しいデータは false', () => {
  const now = new Date('2026-05-18T16:00:00+09:00');
  assert.equal(isStale('2026-05-18T15:30:00+09:00', now, 60), false);
});

test('isStale: 閾値より古いデータは true', () => {
  const now = new Date('2026-05-18T16:00:00+09:00');
  assert.equal(isStale('2026-05-18T14:00:00+09:00', now, 60), true);
});

test('isStale: 未設定・解釈不能な値は true（取得できていない扱い）', () => {
  const now = new Date('2026-05-18T16:00:00+09:00');
  assert.equal(isStale('', now, 60), true);
  assert.equal(isStale(undefined, now, 60), true);
  assert.equal(isStale('not-a-date', now, 60), true);
});

// --- loadActuals: stall-actuals.json の取得 ---

test('loadActuals: 成功でデータを返し error は null', async () => {
  const calls = [];
  const fetchFn = stubFetch({ 'data/stall-actuals.json': { body: { slots: [] } } }, calls);
  const r = await loadActuals(fetchFn);
  assert.deepEqual(r.data, { slots: [] });
  assert.equal(r.error, null);
  assert.ok(calls.length === 1 && calls[0].path === 'data/stall-actuals.json'
    && calls[0].options && calls[0].options.cache === 'no-store',
    'fetch には data/stall-actuals.json と cache:no-store を渡すこと');
});

test('loadActuals: 404 は error に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({ 'data/stall-actuals.json': { status: 404 } });
  const r = await loadActuals(fetchFn);
  assert.equal(r.data, null);
  assert.equal(r.error, 'HTTP 404');
});

test('loadActuals: fetch 例外も error に記録し例外を投げない', async () => {
  const fetchFn = stubFetch({});
  const r = await loadActuals(fetchFn);
  assert.equal(r.data, null);
  assert.equal(r.error, 'network error');
});

// --- renderActualsTable: 実績スロットのテーブル描画 ---

test('renderActualsTable: スロットを時刻＋台数の表にする', () => {
  const html = renderActualsTable([
    { slotStart: '18:00', slotEnd: '18:15', total: 5 },
    { slotStart: '18:15', slotEnd: '18:30', total: 12 },
  ]);
  assert.ok(html.includes('18:00-18:15'), '時間帯ラベルを含む');
  assert.ok(html.includes('>5<'), '台数 5 を含む');
  assert.ok(html.includes('>12<'), '台数 12 を含む');
  assert.ok(html.includes('<table'), 'table 要素で描画する');
});

test('renderActualsTable: 空配列はデータなし表示', () => {
  const html = renderActualsTable([]);
  assert.ok(html.includes('実績データなし'));
});

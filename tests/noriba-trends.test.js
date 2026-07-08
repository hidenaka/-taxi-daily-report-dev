import { test, assert } from './run.js';
import {
  buildNowMarker,
  buildTimelineHourDividers,
  buildTimelineHourMarkers,
  buildDaypartSummaries,
  initNoribaTrendsPage,
  summarizeStallTrends,
  toTrendBins,
  toVehicleTrendBins,
} from '../tools/js/noriba-trends.js';

test('toTrendBins: advance-forecast slotsを15分傾向行に変換する', () => {
  const bins = toTrendBins([
    { time: '08:00', stalls: { stall1: 1.2, stall2: 0.3, stall3: 0, stall4: 2 } },
  ]);

  assert.equal(bins.length, 1);
  assert.equal(bins[0].label, '08:00-08:15');
  assert.equal(bins[0].stall1, 1.2);
  assert.equal(bins[0].stall2, 0.3);
  assert.equal(bins[0].stall3, 0);
  assert.equal(bins[0].stall4, 2);
  assert.equal(bins[0].total, 3.5);
});

test('toVehicleTrendBins: 号別の横台数で台数目安に変換する', () => {
  const bins = [{ label: '09:00-09:15', stall1: 1.2, stall2: 0.4, stall3: 0, stall4: 2, total: 3.6 }];
  const rows = toVehicleTrendBins(bins, { stall1: 8, stall2: 7, stall3: 8, stall4: 8 });

  assert.equal(rows[0].stall1, 10);
  assert.equal(rows[0].stall2, 3);
  assert.equal(rows[0].stall3, 0);
  assert.equal(rows[0].stall4, 16);
  assert.equal(rows[0].total, 29);
});

test('summarizeStallTrends: 乗り場別のピーク・静かな時間・合計を返す', () => {
  const bins = [
    { label: '08:00-08:15', stall1: 1, stall2: 0.2, stall3: 0, stall4: 0, total: 1.2 },
    { label: '08:15-08:30', stall1: 3, stall2: 0.1, stall3: 0, stall4: 0, total: 3.1 },
    { label: '08:30-08:45', stall1: 0, stall2: 2, stall3: 0, stall4: 0, total: 2 },
  ];

  const summaries = summarizeStallTrends(bins);
  const stall1 = summaries.find(s => s.key === 'stall1');
  const stall2 = summaries.find(s => s.key === 'stall2');

  assert.equal(stall1.total, 4);
  assert.equal(stall1.peakLabel, '08:15-08:30');
  assert.equal(stall1.quietLabel, '08:30-08:45');
  assert.equal(stall2.total, 2.3);
  assert.equal(stall2.peakLabel, '08:30-08:45');
});

test('buildDaypartSummaries: 朝昼夕夜の乗り場別合計を作る', () => {
  const bins = [
    { label: '08:00-08:15', stall1: 1, stall2: 0, stall3: 0, stall4: 0, total: 1 },
    { label: '12:00-12:15', stall1: 0, stall2: 2, stall3: 0, stall4: 0, total: 2 },
    { label: '18:00-18:15', stall1: 0, stall2: 0, stall3: 3, stall4: 0, total: 3 },
    { label: '23:00-23:15', stall1: 0, stall2: 0, stall3: 0, stall4: 4, total: 4 },
  ];

  const rows = buildDaypartSummaries(bins);

  assert.deepEqual(rows.map(r => r.label), ['朝', '昼', '夕方', '夜']);
  assert.deepEqual(rows.map(r => r.range), ['5-11時', '11-16時', '16-21時', '21-5時']);
  assert.equal(rows[0].stall1, 1);
  assert.equal(rows[1].stall2, 2);
  assert.equal(rows[2].stall3, 3);
  assert.equal(rows[3].stall4, 4);
});

test('buildTimelineHourMarkers: 24時間グラフに3時間ごとの時刻ラベルを作る', () => {
  const bins = toTrendBins(Array.from({ length: 96 }, (_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    return {
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      stalls: { stall1: 0, stall2: 0, stall3: 0, stall4: 0 },
    };
  }));

  const markers = buildTimelineHourMarkers(bins);

  assert.deepEqual(markers.map(m => m.label), ['0時', '3時', '6時', '9時', '12時', '15時', '18時', '21時', '24時']);
  assert.deepEqual(markers.map(m => m.position), [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]);
});

test('buildTimelineHourDividers: 1時間ごとの薄い区切り位置を作る', () => {
  const dividers = buildTimelineHourDividers();

  assert.equal(dividers.length, 25);
  assert.equal(dividers[0].position, 0);
  assert.equal(dividers[1].position, 4.2);
  assert.equal(dividers[12].position, 50);
  assert.equal(dividers[24].position, 100);
});

test('buildNowMarker: 現在時刻を24時間グラフ上の位置に変換する', () => {
  const marker = buildNowMarker(new Date('2026-07-08T12:30:00+09:00'));

  assert.equal(marker.label, '現在 12:30');
  assert.equal(marker.position, 52.1);
});

test('initNoribaTrendsPage: 回数が列移動の回数（参考）だと表示する', async () => {
  global.localStorage = { getItem: () => 'count', setItem: () => {} };
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const error = { hidden: true, textContent: '' };
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      generatedAt: '2026-07-08T10:00:00+09:00',
      trainedRows: 1,
      rowWidth: { stall1: 8, stall2: 7, stall3: 8, stall4: 8 },
      slots: [{ time: '00:00', stalls: { stall1: 1, stall2: 0, stall3: 0, stall4: 0 } }],
      actualsToday: [],
    }),
  });

  await initNoribaTrendsPage({ root, error, fetchFn });

  assert.ok(root.innerHTML.includes('列移動の回数（参考）'));
});

test('initNoribaTrendsPage: 現在時刻の縦線とライブカメラを表示する', async () => {
  global.localStorage = { getItem: () => 'count', setItem: () => {} };
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const error = { hidden: true, textContent: '' };
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      generatedAt: '2026-07-08T10:00:00+09:00',
      trainedRows: 1,
      rowWidth: { stall1: 8, stall2: 7, stall3: 8, stall4: 8 },
      slots: [{ time: '00:00', stalls: { stall1: 1, stall2: 0, stall3: 0, stall4: 0 } }],
      actualsToday: [],
    }),
  });

  await initNoribaTrendsPage({
    root,
    error,
    fetchFn,
    now: new Date('2026-07-08T06:00:00+09:00'),
  });

  assert.ok(root.innerHTML.includes('trend-now-line'));
  assert.ok(root.innerHTML.includes('現在 06:00'));
  assert.ok(root.innerHTML.includes('data/pool-cam-real01.jpg'));
  assert.ok(root.innerHTML.includes('data/pool-cam-real02.jpg'));
  assert.ok(root.innerHTML.indexOf('24時間の平均パターン') < root.innerHTML.indexOf('ライブカメラ'));
  assert.ok(root.innerHTML.includes('trend-y-axis'));
  assert.ok(root.innerHTML.includes('trend-hour-line'));
  assert.ok(root.innerHTML.includes('5-11時'));
  assert.ok(root.innerHTML.includes('21-5時'));
});

import { test, assert } from './run.js';
import {
  buildDaypartRows,
  buildNowMarker,
  buildTimelineHourDividers,
  buildTimelineHourMarkers,
  compareLabel,
  initNoribaTrendsPage,
  soFar,
  summarizeRow,
  toHourRows,
} from '../tools/js/noriba-trends.js';

const flat = v => Array.from({ length: 24 }, () => v);

function stand() {
  return {
    generatedAt: '2026-10-27T12:00:00+09:00',
    stalls: {
      stall1: { typicalHourly: flat(10), typicalDays: 12, todayHourly: [...flat(12).slice(0, 12), 0, ...flat(0).slice(13)] },
      stall2: { todayHourly: flat(1) },
    },
  };
}

test('toHourRows: stand-out.json を号ごとの24時間に直す(いつもの日が無い号は null)', () => {
  const rows = toHourRows(stand());
  assert.equal(rows.length, 4);
  assert.equal(rows[0].typical.length, 24);
  assert.equal(rows[0].typicalDays, 12);
  assert.equal(rows[1].typical, null);
  assert.equal(rows[3].today.reduce((a, b) => a + b, 0), 0);
});

test('soFar: 今の時間は経った分だけいつもの日を足す', () => {
  const [row] = toHourRows(stand());
  const r = soFar(row, new Date(2026, 9, 27, 12, 30));
  assert.equal(r.today, 144);
  assert.equal(r.typical, 125);
});

test('summarizeRow: 1日の台数・24時までの残り・多い/少ない時間', () => {
  const rows = toHourRows({ stalls: { stall1: { typicalHourly: [...flat(5).slice(0, 17), 30, ...flat(5).slice(18)], todayHourly: flat(0) } } });
  const s = summarizeRow(rows[0], new Date(2026, 9, 27, 22, 0));
  assert.equal(s.total, 5 * 23 + 30);
  assert.equal(s.peakHour, 17);
  assert.equal(s.restOfDay, 10);
  const none = summarizeRow(rows[1], new Date(2026, 9, 27, 22, 0));
  assert.equal(none.total, null);
  assert.equal(none.restOfDay, null);
});

test('compareLabel: 差が小さければ「いつもくらい」', () => {
  assert.equal(compareLabel(100, 98).key, 'same');
  assert.equal(compareLabel(130, 100).text, 'いつもより 30台 多い');
  assert.equal(compareLabel(70, 100).text, 'いつもより 30台 少ない');
  assert.equal(compareLabel(5, null), null);
});

test('buildDaypartRows: 朝昼夕夜の合計(夜は21-5時)', () => {
  const parts = buildDaypartRows(toHourRows(stand()));
  const night = parts.find(p => p.key === 'night');
  assert.equal(night.stall1, 80);
  assert.equal(night.stall2, null);
  assert.equal(parts.reduce((a, p) => a + p.stall1, 0), 240);
});

test('目盛り・現在線', () => {
  assert.equal(buildTimelineHourMarkers().at(-1).position, 100);
  assert.equal(buildTimelineHourDividers().length, 25);
  assert.equal(buildNowMarker(new Date(2026, 9, 27, 12, 0)).position, 50);
});

test('initNoribaTrendsPage: 取得できなければエラーを出す', async () => {
  const root = { innerHTML: 'x' };
  const error = { hidden: true, textContent: '' };
  await initNoribaTrendsPage({ root, error, fetchFn: async () => ({ ok: false }) });
  assert.equal(error.hidden, false);
  assert.equal(root.innerHTML, '');
});

test('initNoribaTrendsPage: 台数・いつもの日を描く', async () => {
  const root = { innerHTML: '' };
  await initNoribaTrendsPage({ root, error: null, fetchFn: async () => ({ ok: true, json: async () => stand() }), now: new Date(2026, 9, 27, 12, 30) });
  assert.ok(root.innerHTML.includes('乗り場から出ていったタクシーの台数'));
  assert.ok(root.innerHTML.includes('240<span>台/日'));
  assert.ok(root.innerHTML.includes('1号は12日'));
});

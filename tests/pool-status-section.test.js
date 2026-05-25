import { test, assert } from './run.js';
import { levelText, levelDots, activityText, isStale, waitText, trendText, formatStallLine, formatTerminalArrivals } from '../tools/js/pool-status-section.js';

test('pool-status-section pure helpers', async () => {
  assert.equal(levelText('empty'), '空き');
  assert.equal(levelText('full'), '満車');
  assert.equal(levelDots('crowded'), '●●●○');
  assert.equal(activityText({ level: 'active', arrow: 'up' }), '活発↑');
  assert.equal(activityText({ level: 'low', arrow: 'down' }), '少なめ↓');
  assert.equal(activityText(null), '—');
  const now = Date.parse('2026-05-25T12:00:00+09:00');
  assert.equal(isStale('2026-05-25T11:00:00+09:00', now, 30), true);
  assert.equal(isStale('2026-05-25T11:50:00+09:00', now, 30), false);
  assert.equal(isStale('bad-date', now, 30), true);
});

test('pool-status-section: 乗り場フォーマッタ', async () => {
  assert.equal(waitText(20), '約20分');
  assert.equal(waitText(null), '—');
  assert.equal(trendText('up'), '活発↑');
  assert.equal(trendText('flat'), '横ばい→');
  assert.equal(trendText('down'), '少なめ↓');
  assert.equal(trendText('xxx'), '—');
  assert.equal(
    formatStallLine({ label: '第1乗り場', occ: 9, waitMin: 135, trend: 'up' }),
    '第1乗り場：在台 約9台 ／ 待ち目安 約135分 ／ 出 活発↑'
  );
  assert.equal(
    formatStallLine({ label: '第2乗り場', occ: 0, waitMin: null, trend: 'flat' }),
    '第2乗り場：在台 約0台 ／ 待ち目安 — ／ 出 横ばい→'
  );
});

test('pool-status-section: ターミナル到着便フォーマッタ', async () => {
  const ta = { T1: { next30: 5, next60: 8 }, T2: { next30: 0, next60: 7 } };
  assert.deepEqual(formatTerminalArrivals(ta), [
    '第1・2乗り場（JAL T1）これから来る客：30分で約5人 ／ 60分で約8人',
    '第3・4乗り場（ANA T2）これから来る客：30分で約0人 ／ 60分で約7人',
  ]);
  assert.deepEqual(formatTerminalArrivals(null), []);
});

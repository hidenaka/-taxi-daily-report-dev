import { test, assert } from './run.js';
import { levelText, levelDots, activityText, isStale } from '../tools/js/pool-status-section.js';

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

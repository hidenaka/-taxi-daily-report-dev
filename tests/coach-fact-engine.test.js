import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildFactPack, avgTripYen } from '../js/coach/fact-engine.js';

const drives = [
  {
    date: '2026-05-01', departureTime: '07:00',
    trips: [
      { amount: 2000, km: 5, boardTime: '19:10', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isPickup: false, isCancel: false },
      { amount: 2600, km: 7, boardTime: '19:40', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isPickup: false, isCancel: false },
      { amount: 0,    km: 0, boardTime: '20:00', boardPlace: '港区六本木6', alightPlace: '港区六本木6', isPickup: true,  isCancel: true },
    ],
  },
  {
    date: '2026-05-08', departureTime: '07:00',
    trips: [
      { amount: 2400, km: 6, boardTime: '19:15', boardPlace: '港区六本木6', alightPlace: '渋谷区渋谷2', isPickup: false, isCancel: false },
    ],
  },
];

describe('avgTripYen', () => {
  it('キャンセル(amount0)を除いた平均を返す', () => {
    assert.strictEqual(Math.round(avgTripYen(drives)), 2333);
  });
  it('trip 無しは null', () => {
    assert.strictEqual(avgTripYen([]), null);
  });
});

describe('buildFactPack', () => {
  const ctx = { area: '港区六本木', dow: 4, hour: 19, nowMin: 1170, vehicleType: 'premium' };

  it('now と you と配列キーを返す', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.deepStrictEqual(fp.now, { area: '港区六本木', dow: 4, hour: 19, vehicleType: 'premium' });
    assert.ok('hourlyA' in fp.you);
    assert.ok(Array.isArray(fp.nextMoves));
    assert.ok(Array.isArray(fp.highValue));
    assert.strictEqual(fp.goal, null);
  });

  it('goal を渡すと逆算が事実パックに入る', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const fp = buildFactPack({ drives, ctx, goal, todaySales: 21400 });
    assert.strictEqual(fp.goal.remainingYen, 8600);
    assert.strictEqual(fp.goal.neededTrips, 4);
  });

  it('nextMoves は現在エリアから取れた次乗車先で、最大3件', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.ok(fp.nextMoves.length <= 3);
    for (const m of fp.nextMoves) {
      assert.ok(typeof m.area === 'string');
      assert.ok(typeof m.count === 'number');
    }
  });
});

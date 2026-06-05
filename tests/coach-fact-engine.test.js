import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildFactPack, avgTripYen } from '../js/coach/fact-engine.js';

// フィクスチャの日付 2026-05-01 / 2026-05-08 は両方 金曜 (dow=5, JST)。
// hourlyDowEfficiency の実計算パスを通すため:
//   - drives に departureTime / returnTime を追加（乗務時間帯: 07:00〜22:00）
//   - 各 trip に alightTime を追加（boardTime より後）
// nextBoardBreakdown の実計算パスを通すため:
//   - drive 2 の先頭 trip を「港区六本木で降車 → 次 trip が 30分以内に乗車」になる並びに設計。
//   ctx.area='港区六本木' に extractArea(alightPlace='港区六本木2') がマッチする。
const drives = [
  {
    date: '2026-05-01', departureTime: '07:00', returnTime: '22:00',
    trips: [
      { amount: 2000, km: 5, boardTime: '19:10', alightTime: '19:25', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isPickup: false, isCancel: false },
      { amount: 2600, km: 7, boardTime: '19:40', alightTime: '19:55', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isPickup: false, isCancel: false },
      { amount: 0,    km: 0, boardTime: '20:00', alightTime: '20:00', boardPlace: '港区六本木6', alightPlace: '港区六本木6', isPickup: true,  isCancel: true },
    ],
  },
  {
    date: '2026-05-08', departureTime: '07:00', returnTime: '22:00',
    trips: [
      { amount: 1800, km: 4, boardTime: '18:50', alightTime: '19:08', boardPlace: '品川区大井1',  alightPlace: '港区六本木2', isPickup: false, isCancel: false },
      { amount: 2400, km: 6, boardTime: '19:15', alightTime: '19:35', boardPlace: '港区六本木6', alightPlace: '渋谷区渋谷2', isPickup: false, isCancel: false },
    ],
  },
];

describe('avgTripYen', () => {
  it('キャンセル(amount0)を除いた平均を返す', () => {
    // 成立 trip: 2000 + 2600 + 1800 + 2400 = 8800 / 4 = 2200
    assert.strictEqual(Math.round(avgTripYen(drives)), 2200);
  });
  it('trip 無しは null', () => {
    assert.strictEqual(avgTripYen([]), null);
  });
});

describe('buildFactPack', () => {
  // フィクスチャの曜日に合わせて dow=5 (金曜) を使う
  const ctx = { area: '港区六本木', dow: 5, hour: 19, nowMin: 1170, vehicleType: 'premium' };

  it('now と you と配列キーを返す', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.deepStrictEqual(fp.now, { area: '港区六本木', dow: 5, hour: 19, vehicleType: 'premium' });
    assert.ok('hourlyA' in fp.you);
    assert.ok(Array.isArray(fp.nextMoves));
    assert.ok(Array.isArray(fp.highValue));
    assert.strictEqual(fp.goal, null);
  });

  it('goal を渡すと逆算が事実パックに入る', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const fp = buildFactPack({ drives, ctx, goal, todaySales: 21400 });
    assert.strictEqual(fp.goal.remainingYen, 8600);
    // ceil(8600 / 2200) = 4
    assert.strictEqual(fp.goal.neededTrips, 4);
  });

  it('hourlyA: フィクスチャの曜日・時間帯で実計算パスを通り有限数値を返す', () => {
    // 2026-05-01 / 2026-05-08 は dow=5, hour=19。
    // departureTime/returnTime + alightTime が揃っているため cell.days>0 かつ workingMin>0 になる。
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.ok(fp.you.hourlyA !== null, 'hourlyA が null になっている (実計算パスが通っていない)');
    assert.ok(Number.isFinite(fp.you.hourlyA), `hourlyA が有限数でない: ${fp.you.hourlyA}`);
    assert.ok(fp.you.hourlyA > 0, `hourlyA が 0 以下: ${fp.you.hourlyA}`);
  });

  it('nextMoves は現在エリアから取れた次乗車先で、最大3件', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.ok(fp.nextMoves.length <= 3);
    for (const m of fp.nextMoves) {
      assert.ok(typeof m.area === 'string');
      assert.ok(typeof m.count === 'number');
    }
  });

  it('nextMoves: ctx.area で降車後の次乗車先が非空で返る', () => {
    // drive 2: trip0 が 港区六本木2 で降車(19:08) → trip1 が 港区六本木6 から 19:15 に乗車(待ち7分)
    // extractArea('港区六本木2') = '港区六本木' = ctx.area なので nextBoardBreakdown がカウントする。
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.ok(fp.nextMoves.length > 0, 'nextMoves が空 (降車→次乗車ペアが検出されていない)');
    const first = fp.nextMoves[0];
    assert.ok(typeof first.area === 'string' && first.area.length > 0);
    assert.ok(typeof first.count === 'number' && first.count > 0);
  });

  it('regime: dow×hourの期待乗車数からvolume/valueを判定して載せる', () => {
    const busy = [
      { date: '2026-05-01', departureTime: '07:00', returnTime: '23:00', trips: [
        { amount: 2000, boardTime: '19:10', alightTime: '19:25', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isCancel: false },
        { amount: 2200, boardTime: '19:40', alightTime: '19:55', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isCancel: false },
      ] },
      { date: '2026-05-08', departureTime: '07:00', returnTime: '23:00', trips: [
        { amount: 2400, boardTime: '19:15', alightTime: '19:30', boardPlace: '港区六本木6', alightPlace: '渋谷区渋谷2', isCancel: false },
      ] },
    ];
    const fp = buildFactPack({ drives: busy, ctx: { area: '港区六本木', dow: 5, hour: 19, nowMin: 1140, vehicleType: 'premium' }, goal: null, todaySales: 0 });
    assert.strictEqual(fp.regime.kind, 'volume');
    assert.strictEqual(fp.regime.density, 1.5);
    const fp2 = buildFactPack({ drives: busy, ctx: { area: '港区六本木', dow: 1, hour: 19, nowMin: 1140, vehicleType: 'premium' }, goal: null, todaySales: 0 });
    assert.strictEqual(fp2.regime.kind, 'unknown');
  });

  it('highValue(spots)は現在の時間帯のみ（夜に午前の高単価を出さない）', () => {
    const mixed = [
      { date: '2026-05-01', departureTime: '07:00', returnTime: '23:00', trips: [
        { amount: 3000, boardTime: '10:00', alightTime: '10:20', boardPlace: '新宿区西新宿1', alightPlace: '渋谷区渋谷1', isPickup: false, isCancel: false },
        { amount: 2500, boardTime: '19:00', alightTime: '19:20', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isPickup: false, isCancel: false },
      ] },
    ];
    const evening = buildFactPack({ drives: mixed, ctx: { area: '港区六本木', dow: 5, hour: 19, nowMin: 1140, vehicleType: 'premium' }, goal: null, todaySales: 0 });
    assert.ok(evening.highValue.every((h) => h.period === 'evening'), '夜なのにevening以外が混入');
    assert.ok(!evening.highValue.some((h) => h.area === '新宿区西新宿'), '午前の高単価エリアが夜に出ている');

    const morning = buildFactPack({ drives: mixed, ctx: { area: '新宿区西新宿', dow: 5, hour: 10, nowMin: 600, vehicleType: 'premium' }, goal: null, todaySales: 0 });
    assert.ok(morning.highValue.every((h) => h.period === 'morning'), '午前なのにmorning以外が混入');
  });
});

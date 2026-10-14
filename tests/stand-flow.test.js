import { test, assert } from './run.js';
import { standModel, moveModel, futureSeats, chartSvg } from '../tools/js/stand-flow.js';

test('standModel: 直近30分・1時間・30分ごと・数え始めを号ごとに。数えていない号は null', async () => {
  const d = { bins30End: ['16:13', '16:43', '17:13', '17:43'], stalls: {
    stall1: { lastHour: 20, last30: 12, bins30: [1, 9, 8, 12], todayHourly: new Array(24).fill(0), countingSince: '2026-10-14T16:08:54+09:00' },
    stall2: { lastHour: null, status: 'stale' },
  } };
  const m = standModel(d);
  assert.deepEqual(m.ends, ['16:13', '16:43', '17:13', '17:43']);
  assert.equal(m.lanes[1].last30, 12);
  assert.equal(m.lanes[1].lastHour, 20);
  assert.equal(m.lanes[1].since, '16:08');
  assert.equal(m.lanes[2], null);
  assert.equal(m.lanes[3], null);
});

test('moveModel: 15分ごとの列移動を30分ごと4本に。直近30分=最後の2本、直近1時間=最後の4本', async () => {
  const t = ['15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15', '17:30'];
  const adv = { actualsToday: t.map((time, i) => ({ time, stalls: { stall1: i % 2, stall2: 1, stall3: 0, stall4: i } })) };
  const m = moveModel(adv);
  assert.deepEqual(m.ends, ['16:15', '16:45', '17:15', '17:45']);
  assert.deepEqual(m.lanes[2].bins, [2, 2, 2, 2]);
  assert.equal(m.lanes[2].last30, 2);
  assert.equal(m.lanes[2].lastHour, 4);
  assert.equal(m.lanes[4].lastHour, 4 + 5 + 6 + 7);
  assert.equal(m.lanes[4].hourly[17], 5 + 6 + 7);
});

test('moveModel: データ無しは全号 null', async () => {
  const m = moveModel(null);
  assert.equal(m.lanes[1], null);
});

test('futureSeats: 号ごとに15分ごとの座席数と30分以内の便数。欠航・別の号・過去の便は数えない', async () => {
  const fl = [
    { poolLane: 3, lobbyExitTime: '17:05', seatCount: 166 },
    { poolLane: 3, lobbyExitTime: '17:20', seatCount: 270 },
    { poolLane: 3, lobbyExitTime: '17:50', seatCount: 200 },
    { poolLane: 3, lobbyExitTime: '18:10', seatCount: 300 },
    { poolLane: 3, lobbyExitTime: '16:50', seatCount: 999 },
    { poolLane: 3, lobbyExitTime: '17:10', seatCount: 500, status: '欠航' },
    { poolLane: 4, lobbyExitTime: '17:10', seatCount: 400 },
  ];
  const r = futureSeats(fl, 3, 17 * 60);
  assert.deepEqual(r.bins, [166, 270, 0, 200]);
  assert.deepEqual(r.next30, { flights: 2, seats: 436 });
});

test('futureSeats: 0時をまたぐ便も数える', async () => {
  const r = futureSeats([{ poolLane: 1, lobbyExitTime: '00:10', seatCount: 150 }], 1, 23 * 60 + 50);
  assert.deepEqual(r.bins, [0, 150, 0, 0]);
});

test('chartSvg: 出た数の4本＋右に見込み2本。数字は長い棒は中、短い棒は上', async () => {
  const svg = chartSvg([10, 1, 10, 10], ['a', 'b', 'c', 'd'], [9, 8], '台');
  assert.ok(svg.includes('class="sf-tv in ">10</text>'));
  assert.ok(svg.includes('class="sf-tv ">1</text>'));
  assert.ok(svg.includes('>いま</text>'));
  assert.ok(svg.includes('class="sf-fc"'));
  assert.ok(svg.includes('+60分'));
  assert.ok(!svg.includes('座席'));
});

test('chartSvg: 見込みが無ければ出た数だけ', async () => {
  const svg = chartSvg([3, 4], ['a', 'b'], null, '台');
  assert.ok(!svg.includes('sf-fc'));
});

test('standModel: forecast30 を見込みとして持つ', async () => {
  const m = standModel({ stalls: { stall1: { lastHour: 20, last30: 10, bins30: [1, 2, 3, 10], forecast30: [9, 8] } } });
  assert.deepEqual(m.lanes[1].fc, [9, 8]);
});

test('moveModel: 列移動の見込みは予測(15分ごと)をいまから30分ずつ足す', async () => {
  const adv = { actualsToday: [{ time: '17:00', stalls: { stall1: 1 } }, { time: '17:15', stalls: { stall1: 1 } }],
    slots: [{ time: '17:30', stalls: { stall1: 0.6 } }, { time: '17:45', stalls: { stall1: 0.6 } }, { time: '18:00', stalls: { stall1: 1.4 } }, { time: '18:15', stalls: { stall1: 1.0 } }] };
  const m = moveModel(adv, 17 * 60 + 30);
  assert.deepEqual(m.lanes[1].fc, [1, 2]);
});

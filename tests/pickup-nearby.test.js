// 「いまいる場所から近い順に、そこで乗せた実績」
//
// 元の推奨検索は「Xで降ろした後 → Yで乗せた」という流れを数えていた。
// 流れを条件にすると材料がほぼ全部落ちる（本番実データ: 港区赤坂20時で2行しか出ない）。
// 「その場所で乗せた記録」だけを見れば、同じ条件で22か所・131回といった厚みが残り、
// 距離と待ち時間まで出せる。分母の説明も要らなくなる（回数はそのまま回数）。
import { test } from 'node:test';
import assert from 'node:assert';
import { pickupAreaStats } from '../js/chart-helpers.js';
import { pickupSpotsNear } from '../js/area-geo.js';

const COORDS = {
  '港区赤坂': [35.6726, 139.7371],
  '港区六本木': [35.6641, 139.7315],      // 赤坂から約1.0km
  '千代田区麹町': [35.6857, 139.7383],    // 約1.5km
  '世田谷区成城': [35.6404, 139.5979],    // 約13km
};

// 1乗務ぶん。[乗せた場所, 乗せた時刻, 運賃, 直前の降車時刻]
function drive(date, rows) {
  const trips = [];
  for (const [place, time, amount, prevAlight] of rows) {
    if (prevAlight) trips.push({ boardPlace: 'どこか1', boardTime: '00:00', alightTime: prevAlight, alightPlace: 'どこか2', amount: 1000 });
    trips.push({ boardPlace: place, boardTime: time, alightTime: time, alightPlace: 'どこか3', amount });
  }
  return { date, trips };
}

test('乗せた場所ごとに 回数・平均/中央単価 を出す', () => {
  const s = pickupAreaStats([
    drive('2026-08-01', [['港区赤坂1', '20:00', 2000, null], ['港区赤坂2', '20:30', 4000, null]]),
    drive('2026-08-02', [['港区赤坂3', '20:10', 3000, null]]),
  ]);
  assert.strictEqual(s['港区赤坂'].count, 3);
  assert.strictEqual(s['港区赤坂'].avgSales, 3000);
  assert.strictEqual(s['港区赤坂'].medianSales, 3000);
});

test('その場所で拾うまでの待ち時間（直前の降車からの空車時間）の中央値を出す', () => {
  const s = pickupAreaStats([
    drive('2026-08-01', [['港区赤坂1', '20:10', 2000, '20:00']]),   // 10分待ち
    drive('2026-08-02', [['港区赤坂2', '20:20', 2000, '20:00']]),   // 20分待ち
    drive('2026-08-03', [['港区赤坂3', '20:30', 2000, '20:00']]),   // 30分待ち
  ]);
  assert.strictEqual(s['港区赤坂'].medianWait, 20);
  assert.strictEqual(s['港区赤坂'].waitCount, 3);
});

test('長すぎる空車は待ちに数えない（休憩や帰庫をまたいでいるため）', () => {
  const s = pickupAreaStats([
    drive('2026-08-01', [['港区赤坂1', '20:10', 2000, '20:00']]),   // 10分
    drive('2026-08-02', [['港区赤坂2', '20:00', 2000, '15:00']]),   // 5時間 → 数えない
  ]);
  assert.strictEqual(s['港区赤坂'].waitCount, 1);
  assert.strictEqual(s['港区赤坂'].medianWait, 10);
});

test('その日の最初の乗車は待ちが分からないので数えない', () => {
  const s = pickupAreaStats([drive('2026-08-01', [['港区赤坂1', '20:00', 2000, null]])]);
  assert.strictEqual(s['港区赤坂'].count, 1);
  assert.strictEqual(s['港区赤坂'].waitCount, 0);
  assert.strictEqual(s['港区赤坂'].medianWait, null);
});

test('時間帯で絞れる', () => {
  const drives = [drive('2026-08-01', [['港区赤坂1', '20:00', 9000, null], ['港区赤坂2', '08:00', 1000, null]])];
  assert.strictEqual(pickupAreaStats(drives).one, undefined);
  assert.strictEqual(pickupAreaStats(drives)['港区赤坂'].count, 2);
  assert.strictEqual(pickupAreaStats(drives, 20, 1)['港区赤坂'].count, 1);
  assert.strictEqual(pickupAreaStats(drives, 20, 1)['港区赤坂'].avgSales, 9000);
});

test('キャンセルと¥0は数えない', () => {
  const s = pickupAreaStats([{ date: '2026-08-01', trips: [
    { boardPlace: '港区赤坂1', boardTime: '20:00', alightTime: '20:20', alightPlace: 'x', amount: 3000 },
    { boardPlace: '港区赤坂2', boardTime: '20:05', alightTime: '20:25', alightPlace: 'x', amount: 5000, isCancel: true },
    { boardPlace: '港区赤坂3', boardTime: '20:10', alightTime: '20:30', alightPlace: 'x', amount: 0 },
  ] }]);
  assert.strictEqual(s['港区赤坂'].count, 1);
});

// --- 近い順に並べる ---
const STATS = {
  '港区赤坂':     { count: 117, avgSales: 2782, medianSales: 2000, medianWait: 9,  waitCount: 115 },
  '港区六本木':   { count: 94,  avgSales: 3637, medianSales: 2300, medianWait: 8,  waitCount: 94 },
  '千代田区麹町': { count: 11,  avgSales: 3945, medianSales: 2700, medianWait: 9,  waitCount: 11 },
  '世田谷区成城': { count: 10,  avgSales: 6000, medianSales: 5000, medianWait: 20, waitCount: 10 },
};

test('起点から近い順に並び、起点そのものも含む', () => {
  const r = pickupSpotsNear({ area: '港区赤坂', coords: COORDS, stats: STATS, radiusKm: 2 });
  assert.deepStrictEqual(r.map(x => x.area), ['港区赤坂', '港区六本木', '千代田区麹町']);
  assert.strictEqual(r[0].km, 0);
  assert.strictEqual(r[0].isHere, true);
  assert.strictEqual(r[1].isHere, false);
  assert.ok(!r.some(x => x.area === '世田谷区成城'), '2kmより遠い場所は出さない');
});

test('回数が少ない場所は出さない', () => {
  const r = pickupSpotsNear({ area: '港区赤坂', coords: COORDS, stats: STATS, radiusKm: 2, minCount: 50 });
  assert.deepStrictEqual(r.map(x => x.area), ['港区赤坂', '港区六本木']);
});

test('GPSの座標を直接起点にできる（町名が過去データに無くてもよい）', () => {
  const r = pickupSpotsNear({ originPoint: [35.6726, 139.7371], coords: COORDS, stats: STATS, radiusKm: 2 });
  assert.ok(r.some(x => x.area === '港区六本木'));
  assert.strictEqual(r[0].area, '港区赤坂');
});

test('並び順を単価・待ちに変えられる', () => {
  const base = { area: '港区赤坂', coords: COORDS, stats: STATS, radiusKm: 2 };
  assert.strictEqual(pickupSpotsNear({ ...base, sort: 'sales' })[0].area, '千代田区麹町');
  assert.strictEqual(pickupSpotsNear({ ...base, sort: 'wait' })[0].area, '港区六本木');
  assert.strictEqual(pickupSpotsNear({ ...base, sort: 'count' })[0].area, '港区赤坂');
});

test('座標が引けない起点なら空配列（落ちない）', () => {
  assert.deepStrictEqual(pickupSpotsNear({ area: '架空区どこか', coords: COORDS, stats: STATS }), []);
  assert.deepStrictEqual(pickupSpotsNear({ coords: COORDS, stats: STATS }), []);
});

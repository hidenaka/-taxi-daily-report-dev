import { test } from 'node:test';
import assert from 'node:assert';
import { tripToPoolItem, driveToPoolItems, buildPoolItems } from '../js/group-anon.js';

test('tripToPoolItem: 通常乗車を匿名itemに変換しエリアを粗化する', () => {
  const item = tripToPoolItem({
    type: 'trip', no: 1, pickupKind: '迎',
    boardTime: '07:17', alightTime: '07:38',
    boardPlace: '大田区上池台4', alightPlace: '港区港南2',
    km: 6.7, amount: 3600, isPickup: true, isCharter: false, isCancel: false,
  });
  assert.deepEqual(item, {
    boardTime: '07:17',
    pickupArea: '大田区上池台',
    dropoffArea: '港区港南',
    km: 6.7,
    amount: 3600,
    isPickup: true,
  });
});

test('tripToPoolItem: 身元/生地名/メモ系のキーは含めない', () => {
  const item = tripToPoolItem({
    type: 'trip', no: 3, pickupKind: '迎', boardPlace: '中央区銀座8',
    alightPlace: '江東区青海2', boardTime: '11:40', amount: 2100, km: 4.2,
    isPickup: true, isCancel: false, _userId: 'taro', memo: '常連さん',
  });
  assert.deepEqual(Object.keys(item).sort(),
    ['amount', 'boardTime', 'dropoffArea', 'isPickup', 'km', 'pickupArea']);
  assert.ok(!('boardPlace' in item) && !('no' in item) && !('_userId' in item) && !('memo' in item));
});

test('tripToPoolItem: キャンセルは null', () => {
  assert.equal(tripToPoolItem({ type: 'trip', isCancel: true, amount: 0 }), null);
});

test('tripToPoolItem: 乗車以外(休憩 type!==trip)は null', () => {
  assert.equal(tripToPoolItem({ type: 'rest', startTime: '10:47', endTime: '11:36' }), null);
});

test('tripToPoolItem: 欠損値は null/空に正規化', () => {
  const item = tripToPoolItem({ type: 'trip', isCancel: false });
  assert.equal(item.boardTime, null);
  assert.equal(item.pickupArea, null);
  assert.equal(item.dropoffArea, null);
  assert.equal(item.km, null);
  assert.equal(item.amount, null);
  assert.equal(item.isPickup, false);
});

test('tripToPoolItem: amount 0(正当な0円・非キャンセル)は null にならず amount:0 を保つ', () => {
  const item = tripToPoolItem({ type: 'trip', isCancel: false, amount: 0, km: 1.2, boardPlace: '港区芝', alightPlace: '港区三田', boardTime: '09:00', isPickup: false });
  assert.notEqual(item, null);
  assert.strictEqual(item.amount, 0);
});

test('driveToPoolItems: trips を pool items に変換しキャンセルを除外', () => {
  const drive = {
    date: '2026-05-01', departureTime: '07:00', returnTime: '17:00',
    trips: [
      { type: 'trip', boardTime: '07:17', boardPlace: '大田区上池台4', alightPlace: '港区港南2', km: 6.7, amount: 3600, isPickup: true, isCancel: false },
      { type: 'trip', isCancel: true, amount: 0 },
      { type: 'trip', boardTime: '11:40', boardPlace: '江東区青海2', alightPlace: '中央区銀座8', km: 4.2, amount: 2100, isPickup: true, isCancel: false },
    ],
    rests: [{ type: 'rest', startTime: '10:00', endTime: '10:30' }],
  };
  const items = driveToPoolItems(drive);
  assert.equal(items.length, 2);
  assert.equal(items[0].pickupArea, '大田区上池台');
  assert.equal(items[1].pickupArea, '江東区青海');
});

test('driveToPoolItems: shareOptOut の日は空配列', () => {
  const drive = {
    date: '2026-05-02', shareOptOut: true,
    trips: [{ type: 'trip', boardTime: '08:00', boardPlace: '品川区', alightPlace: '港区', km: 3, amount: 1500, isPickup: false, isCancel: false }],
  };
  assert.deepEqual(driveToPoolItems(drive), []);
});

test('driveToPoolItems: trips 無し/不正でも空配列', () => {
  assert.deepEqual(driveToPoolItems({ date: '2026-05-03' }), []);
  assert.deepEqual(driveToPoolItems(null), []);
});

test('buildPoolItems: 複数driveを平坦化しopt-out日を除外', () => {
  const drives = [
    { date: '2026-05-01', trips: [
      { type: 'trip', boardTime: '07:17', boardPlace: '大田区上池台4', alightPlace: '港区港南2', km: 6.7, amount: 3600, isPickup: true, isCancel: false },
    ]},
    { date: '2026-05-02', shareOptOut: true, trips: [
      { type: 'trip', boardTime: '08:00', boardPlace: '品川区', alightPlace: '港区', km: 3, amount: 1500, isPickup: false, isCancel: false },
    ]},
    { date: '2026-05-03', trips: [
      { type: 'trip', boardTime: '19:30', boardPlace: '中央区銀座8', alightPlace: '江東区青海2', km: 4.2, amount: 2100, isPickup: false, isCancel: false },
      { type: 'trip', isCancel: true, amount: 0 },
    ]},
  ];
  const pool = buildPoolItems(drives);
  assert.equal(pool.length, 2); // 05-01の1件 + 05-03の1件(キャンセル除外, opt-out日除外)
  assert.deepEqual(pool.map(p => p.pickupArea), ['大田区上池台', '中央区銀座']);
  // バラのtrip単位＝日付やuserIdに紐付かない（1日まとめが復元できない）
  assert.ok(pool.every(p => !('date' in p) && !('_userId' in p)));
});

test('buildPoolItems: 配列以外は空配列', () => {
  assert.deepEqual(buildPoolItems(null), []);
  assert.deepEqual(buildPoolItems(undefined), []);
});

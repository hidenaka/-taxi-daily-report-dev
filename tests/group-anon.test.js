import { test } from 'node:test';
import assert from 'node:assert';
import { tripToPoolItem } from '../js/group-anon.js';

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

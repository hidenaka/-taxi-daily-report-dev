// 「この日のまとめ」の遅れの数え方
//
// 確定後のデータは estimatedTime が定刻のまま残り、実際の到着は actualTime に入る。
// estimatedTime を先に見ていたため 9/8 は「15分以上の遅れ 1便」と出ていたが、
// 実際に着いた時刻で数えると 194便だった。
// また配信データには "39:20" のような壊れた時刻がまれに混ざり、
// これが「最大 1240分遅れ」として出ていた。
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSummary } from '../.github/scripts/day-summary.mjs';

const f = (over = {}) => ({ flightNumber: 'XX001', fromName: '札幌', scheduledTime: '10:00', estimatedTime: '10:00', actualTime: null, status: '到着', poolLane: 1, ...over });

test('実際に着いた時刻で数える（到着予定が定刻のまま残っていても）', () => {
  const s = buildSummary({ flights: [f({ scheduledTime: '18:15', estimatedTime: '18:15', actualTime: '18:44' })] });
  assert.equal(s.delayed15, 1);
  assert.equal(s.delayed30, 0);
  assert.equal(s.maxDelay, 29);
});

test('まだ着いていない便は到着予定で数える', () => {
  const s = buildSummary({ flights: [f({ scheduledTime: '22:40', estimatedTime: '24:33', actualTime: null, status: '不明' })] });
  assert.equal(s.delayed30, 1);
  assert.equal(s.maxDelay, 113);
  assert.equal(s.overnightFlights.length, 1, '日をまたいだ便として拾う');
});

test('壊れた時刻は数に入れない', () => {
  // 実データ 9/2 NH088: 定刻18:40 / 到着予定 "39:20"（ありえない時刻）
  const s = buildSummary({ flights: [
    f({ flightNumber: 'NH088', scheduledTime: '18:40', estimatedTime: '39:20' }),
    f({ scheduledTime: '10:00', actualTime: '10:40' }),
  ] });
  assert.equal(s.maxDelay, 40, '1240分ではなく、まともな便の40分が最大');
  assert.equal(s.delayed15, 1);
});

test('欠航便は遅れに数えず、別に数える', () => {
  const s = buildSummary({ flights: [
    f({ status: '欠航', actualTime: '12:00' }),
    f({ scheduledTime: '10:00', actualTime: '10:20' }),
  ] });
  assert.equal(s.cancelledCount, 1);
  assert.equal(s.totalFlights, 1);
  assert.equal(s.delayed15, 1);
});

test('早く着いた便は遅れではない', () => {
  const s = buildSummary({ flights: [f({ scheduledTime: '16:40', actualTime: '16:34' })] });
  assert.equal(s.delayed15, 0);
  assert.equal(s.maxDelay, 0);
});

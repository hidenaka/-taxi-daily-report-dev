// 遅延の数え方を「時刻の差」で統一する
//
// 背景: 画面の遅延表示は status === '遅延' を数えていたが、羽田の配信データに
// その status は一度も現れない(7日ぶん・3,600便を確認: 到着 / 不明 / 欠航 のみ)。
// そのため時間帯別グラフの「⚠N遅延」も集計の「N便遅延」も、永久に出なかった。
//
// また過去日のまとめは estimatedTime を優先して数えていたが、確定後のデータでは
// estimatedTime が定刻のまま残り、実際の到着は actualTime に入る。
// 9/8 は「15分以上の遅れ 1便」と出ていたが、実際に着いた時刻で数えると 193便だった。
//
// → 実際に着いた時刻(actualTime)を優先し、無ければ到着予定(estimatedTime)で数える。
import { test } from 'node:test';
import assert from 'node:assert';
import { delayMinutesOf, DELAY_MIN, aggregateHeatmapClient, summarizeFlights } from '../tools/js/arrivals-data.js';

const f = (over = {}) => ({
  scheduledTime: '10:00', estimatedTime: '10:00', status: '到着',
  seatCount: 300, isInternational: false, ...over,
});

test('遅れは「実際に着いた時刻 − 定刻」で数える', () => {
  assert.equal(delayMinutesOf(f({ scheduledTime: '18:15', actualTime: '18:44' })), 29);
});

test('まだ着いていない便は「到着予定 − 定刻」で数える', () => {
  assert.equal(delayMinutesOf(f({ scheduledTime: '18:15', estimatedTime: '18:48', status: '不明' })), 33);
});

test('実際に着いた時刻があれば、そちらを優先する', () => {
  // 確定後のデータは estimatedTime が定刻のまま残る（実データで確認）
  const v = delayMinutesOf(f({ scheduledTime: '18:15', estimatedTime: '18:15', actualTime: '18:44' }));
  assert.equal(v, 29, 'estimatedTime を信じると 0 になってしまう');
});

test('日をまたいでも正しく数える', () => {
  assert.equal(delayMinutesOf(f({ scheduledTime: '23:50', actualTime: '00:40' })), 50);
});

test('早く着いた便は遅れ0分あつかい', () => {
  assert.equal(delayMinutesOf(f({ scheduledTime: '16:40', actualTime: '16:34' })), 0);
});

test('時刻が無ければ数えられない', () => {
  assert.equal(delayMinutesOf(f({ scheduledTime: null, estimatedTime: null, actualTime: null })), null);
});

test('遅れとみなす下限は15分', () => {
  assert.equal(DELAY_MIN, 15);
});

test('時間帯別グラフの遅延数は、時刻の差で数える', () => {
  const bins = aggregateHeatmapClient([
    f({ scheduledTime: '10:00', actualTime: '10:20' }),  // 20分 → 遅延
    f({ scheduledTime: '10:00', actualTime: '10:10' }),  // 10分 → 遅延ではない
    f({ scheduledTime: '10:00', actualTime: '10:00' }),
  ]);
  assert.equal(bins[0].delayedCount, 1);
});

test('欠航便は遅延に数えない', () => {
  const bins = aggregateHeatmapClient([
    f({ scheduledTime: '10:00', actualTime: '11:00', status: '欠航' }),
    f({ scheduledTime: '10:00', actualTime: '10:20' }),
  ]);
  assert.equal(bins[0].delayedCount, 1);
});

test('集計の遅延数も同じ数え方にする', () => {
  const s = summarizeFlights([
    f({ scheduledTime: '10:00', actualTime: '10:20' }),
    f({ scheduledTime: '10:00', actualTime: '10:05' }),
  ], { windowHours: 2, windowLabel: 'x' });
  assert.equal(s.delayedCount, 1);
});

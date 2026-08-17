import { test } from 'node:test';
import assert from 'node:assert';
import { calcPaceAtElapsed, PACE_OUTLIER_K, PACE_EARLY_LEAVE_MIN } from '../js/chart-helpers.js';

// 出庫ペース参考の「平均累積営収」から何を外すか (2026-08-17 本人指示で見直し)
//  - 上側: とび抜けた日だけ (Q3 + 3×IQR 超)。好調だっただけの日は残す
//  - 下側: 統計では切らない。ただし勤務13時間未満(早退)の日は外す
//
// 実データ(直近6ヶ月48日・出庫6時間後)では、旧基準の上限が ¥52,680 にしかならず
// ¥52,970〜¥56,970 という「ただの好調日」まで落ちて平均が7.8%低く出ていた。

// 出庫7:00・1本だけ乗せて sales 円になる日を作る。returnTime で勤務時間を決める。
const day = (date, sales, returnTime = '21:00') => ({
  date,
  departureTime: '07:00',
  returnTime,
  trips: [{ boardTime: '08:00', alightTime: '08:30', amount: sales }],
  rests: [],
});
const D = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05',
           '2026-06-06','2026-06-07','2026-06-08','2026-06-09','2026-06-10'];
const SIX_H = 6 * 60;

test('とび抜けた日の上限は Q3 + 3×IQR (好調だっただけの日は残す)', () => {
  // 30000..42000 → Q1=34000 Q3=42000 IQR=8000
  //   旧(1.5倍)の上限 ¥54,000 / 新(3倍)の上限 ¥66,000
  const base = [30000, 32000, 34000, 36000, 38000, 40000, 42000];
  const drives = base.map((v, i) => day(D[i], v)).concat([day(D[7], 60000)]);
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(PACE_OUTLIER_K, 3);
  assert.strictEqual(r.upperBound, 66000);
  assert.strictEqual(r.excludedOutlier, 0, '¥60,000 は旧基準では落ちていたが残す');
  assert.strictEqual(r.days, 8);
});

test('本当にとび抜けた日は外す', () => {
  const base = [30000, 32000, 34000, 36000, 38000, 40000, 42000];
  const drives = base.map((v, i) => day(D[i], v)).concat([day(D[7], 90000)]);
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedOutlier, 1);
  assert.strictEqual(r.days, 7);
  assert.strictEqual(r.maxSales, 42000);
});

test('低い日は切らない (悪かった日も自分の実績)', () => {
  const base = [30000, 32000, 34000, 36000, 38000, 40000, 42000];
  const drives = base.map((v, i) => day(D[i], v)).concat([day(D[7], 1000)]);
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedOutlier, 0);
  assert.strictEqual(r.excludedEarly, 0);
  assert.strictEqual(r.minSales, 1000, '極端に低い日も残る');
  assert.strictEqual(r.days, 8);
});

test('勤務13時間未満の日は早退として外す', () => {
  assert.strictEqual(PACE_EARLY_LEAVE_MIN, 780);
  const drives = [
    day(D[0], 40000), day(D[1], 41000), day(D[2], 42000), day(D[3], 43000),
    day(D[4], 10000, '19:00'),   // 勤務12時間 = 早退
  ];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 1);
  assert.strictEqual(r.days, 4);
  assert.strictEqual(r.avgSales, (40000 + 41000 + 42000 + 43000) / 4);
});

test('ちょうど13時間は早退にしない', () => {
  const drives = [
    day(D[0], 40000), day(D[1], 41000), day(D[2], 42000),
    day(D[3], 20000, '20:00'),   // 出庫7:00→20:00 = 13時間ちょうど
  ];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 0);
  assert.strictEqual(r.days, 4);
});

test('帰庫時刻が無い日は早退と判定できないので残す', () => {
  const noReturn = { ...day(D[3], 20000), returnTime: null };
  const drives = [day(D[0], 40000), day(D[1], 41000), day(D[2], 42000), noReturn];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 0);
  assert.strictEqual(r.days, 4);
});

test('日をまたぐ勤務でも時間を正しく数える', () => {
  // 7:00出庫 → 翌2:00帰庫 = 19時間
  const drives = [
    day(D[0], 40000, '02:00'), day(D[1], 41000, '02:00'),
    day(D[2], 42000, '02:00'), day(D[3], 43000, '02:00'),
  ];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 0, '19時間勤務を早退にしない');
});

test('早退を外すと3日未満になるときは外さない (母数が消えるのを防ぐ)', () => {
  // 短い勤務が常態の人でカードが空になると使えなくなる
  const drives = [
    day(D[0], 20000, '17:00'), day(D[1], 21000, '17:00'),
    day(D[2], 22000, '17:00'), day(D[3], 40000, '21:00'),
  ];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 0, '10時間勤務ばかりでも全部使う');
  assert.strictEqual(r.days, 4);
});

test('早退ととび抜けは別々に数えて返す', () => {
  const base = [30000, 32000, 34000, 36000, 38000, 40000, 42000];
  const drives = base.map((v, i) => day(D[i], v))
    .concat([day(D[7], 90000), day(D[8], 5000, '18:00')]);
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.excludedEarly, 1);
  assert.strictEqual(r.excludedOutlier, 1);
  assert.strictEqual(r.excludedDays, 2, '合計は従来どおりの意味で残す');
  assert.strictEqual(r.days, 7);
});

test('外れ値が半数を超えるときは全部使う (従来の保険)', () => {
  const drives = [day(D[0], 1000), day(D[1], 1000), day(D[2], 90000), day(D[3], 95000)];
  const r = calcPaceAtElapsed(drives, [7], SIX_H, null);
  assert.strictEqual(r.days, 4);
  assert.strictEqual(r.excludedOutlier, 0);
});

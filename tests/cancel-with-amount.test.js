// キャンセルでも金額が入っていれば売上に計上する (2026-08-10 本人要望)。
// 背景: 実車はキャンセルになったが、タクシーチケット等で営業収益が補填されることがある。
// その分は明細の金額欄に手入力されるので、売上として扱わないと日報が実態と合わない。
// 一方、営業回数・実車距離は「実際に走った量」なので従来どおりキャンセルを数えない。
import { test, assert } from './run.js';
import { calcDailySales, tripAmount, isCompensatedCancel } from '../js/payroll.js';
import { parseReport } from '../js/parser.js';

const trip = (amount, isCancel = false) => ({ amount, isCancel, km: 5 });

test('tripAmount: キャンセルでも金額があれば計上、0なら0', () => {
  assert.equal(tripAmount(trip(3000)), 3000);
  assert.equal(tripAmount(trip(2000, true)), 2000, 'キャンセル+補填');
  assert.equal(tripAmount(trip(0, true)), 0, '通常のキャンセル');
  assert.equal(tripAmount(trip(null, true)), 0);
  assert.equal(tripAmount(null), 0);
});

test('isCompensatedCancel: 補填ありキャンセルだけ true', () => {
  assert.equal(isCompensatedCancel(trip(2000, true)), true);
  assert.equal(isCompensatedCancel(trip(0, true)), false);
  assert.equal(isCompensatedCancel(trip(3000, false)), false);
});

test('calcDailySales: 補填ありキャンセルを売上に含める', () => {
  const drive = { date: '2026-08-10', trips: [trip(5000), trip(2000, true), trip(0, true)] };
  assert.equal(calcDailySales(drive).inclTax, 7000, '5000 + 補填2000');
});

test('calcDailySales: 従来のキャンセル(金額0)のみなら挙動不変', () => {
  const drive = { date: '2026-08-10', trips: [trip(5000), trip(0, true)] };
  assert.equal(calcDailySales(drive).inclTax, 5000);
});

// 列: No 乗車 降車 時間 迎 乗車地 降車地 営Km 合計 待機 (tests/fixtures/sample-claude.txt と同じ)
const HEADER = 'No\t乗車\t降車\t時間\t迎\t乗車地\t降車地\t営Km\t合計\t待機';
const row = (cells) => parseReport(HEADER + '\n' + cells.join('\t')).trips[0];

test('parseReport: 「キ」マーカー行の印字金額は残す(補填が印字されるケース)', () => {
  const t = row(['キ', '10:00', '10:05', '0:05', '', '大田区羽田1', '大田区羽田1', '0.0', '2,000', '']);
  assert.equal(t.isCancel, true);
  assert.equal(t.amount, 2000);
});

test('parseReport: キャンセル料(400円)由来の判定は従来どおり金額0', () => {
  const t = row(['12', '10:00', '10:05', '0:05', '', '大田区羽田1', '大田区羽田1', '0.0', '400', '']);
  assert.equal(t.isCancel, true);
  assert.equal(t.amount, 0);
});

test('parseReport: 通常の乗車は影響を受けない', () => {
  const t = row(['3', '10:00', '10:20', '0:20', '迎', '港区芝1', '中央区銀座1', '5.2', '2,500', '']);
  assert.equal(t.isCancel, false);
  assert.equal(t.amount, 2500);
});

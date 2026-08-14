// 有給を取った月の歩率テーブル段選び (2026-08-14 本人指摘)。
// 「11乗務で10出番＋1日有給のとき、10出番のテーブルで計算されていない時がある」
// 原因: calcBasePay が config.responsibilityShifts(=11) をそのまま使い、有給を無視していた。
// 「あなたの数値」カード(home-metrics)は無条件で予定ベース経路を通るため常に11だった。
import { test, assert } from './run.js';
import { calcBasePay, calcTotalPay } from '../js/payroll.js';
import { computeLandings, requiredToRespCap } from '../js/home-metrics.js';

// 10出番と11出番で明確に歩率が違うテーブル(判定を一意にするため単純化)
const config = {
  responsibilityShifts: 11,
  takeHomeRate: 0.75,
  premiumIncentive: { thresholdSalesExclTax: 999999999, amountPerShift: 0 },
  paidLeaveAmount: 12000,
  shifts: { paidLeaveDates: ['2026-08-05'] },
  rateTable: {
    "10": [{ salesMin: 0, salesMax: 99999999, rate: 0.60 }],
    "11": [{ salesMin: 0, salesMax: 99999999, rate: 0.50 }],
    "12_13rate": 0.62,
  },
};
const drive = (i) => ({ date: `2026-08-${String(i + 10).padStart(2, '0')}`, vehicleType: 'japantaxi', trips: [{ amount: 55000, isCancel: false }] });
const drives10 = Array.from({ length: 10 }, (_, i) => drive(i));

test('calcBasePay: 有給1日ぶん責任出番が下がり10出番のテーブルを使う', () => {
  const r = calcBasePay(drives10, config, { useResponsibilityTier: true, paidLeaveDays: 1 });
  assert.equal(r.breakdown.tierKey, '10');
  assert.equal(r.rate, 0.60);
});

test('calcBasePay: 有給なしなら従来どおり11出番のテーブル', () => {
  const r = calcBasePay(drives10, config, { useResponsibilityTier: true });
  assert.equal(r.breakdown.tierKey, '11');
  assert.equal(r.rate, 0.50);
});

test('calcBasePay: options.respShifts があれば最優先(呼び出し側の予定表を尊重)', () => {
  const r = calcBasePay(drives10, config, { useResponsibilityTier: true, respShifts: 10 });
  assert.equal(r.breakdown.tierKey, '10');
  // 二重控除しない: respShifts があれば paidLeaveDays は無視される
  const r2 = calcBasePay(drives10, config, { useResponsibilityTier: true, respShifts: 10, paidLeaveDays: 1 });
  assert.equal(r2.breakdown.tierKey, '10');
});

test('calcBasePay: 実出番が予定を超えたら実出番の段を使う(過小評価しない)', () => {
  const drives11 = Array.from({ length: 11 }, (_, i) => drive(i));
  const r = calcBasePay(drives11, config, { useResponsibilityTier: true, respShifts: 10 });
  assert.equal(r.breakdown.tierKey, '11');
});

test('calcTotalPay: 期間内の有給日数を自動で歩率テーブルへ反映する', () => {
  const r = calcTotalPay(drives10, config, '2026-08-01', '2026-08-31', { useResponsibilityTier: true });
  assert.equal(r.breakdown.tierKey, '10', '有給1日→10出番のテーブル');
  assert.equal(r.paidLeaveDays, 1);
  assert.equal(r.paidLeaveAmount, 12000);
});

test('calcTotalPay: 期間外の有給は段選びに影響しない', () => {
  const r = calcTotalPay(drives10, config, '2026-09-01', '2026-09-30', { useResponsibilityTier: true });
  assert.equal(r.breakdown.tierKey, '11');
  assert.equal(r.paidLeaveDays, 0);
});

test('computeLandings: あなたの数値カードも10出番のテーブルで計算する', () => {
  // plannedShifts=10 (有給日は予定表と排他なので予定は10日)
  const L = computeLandings(drives10, config, '2026-08-01', '2026-08-31', 10);
  // 10出番テーブル(0.60)で計算されていること: 売上55万*10=550,000(税込) → 税抜500,000
  const expectedBase = (550000 / 1.1) * 0.60;
  assert.equal(Math.round(L.resp.takehome.value), Math.round(expectedBase * 0.75));
});

test('requiredToRespCap: 有給で責任出番が減れば残り出番数も減る', () => {
  const cfg = { ...config, takeHomeAt11Target: 300000 };
  const drives8 = Array.from({ length: 8 }, (_, i) => drive(i));
  const need10 = requiredToRespCap(drives8, cfg, '2026-08-01', '2026-08-31', 10);
  const need11 = requiredToRespCap(drives8, cfg, '2026-08-01', '2026-08-31', 11);
  assert.equal(need10.remaining, 2, '責任10なら残り2出番');
  assert.equal(need11.remaining, 3, '責任11なら残り3出番');
});

// 歩率の段を決める売上は「11出番まで」
//
// 本人指摘(2026-09-11): ホームの歩率まわりが、12出番目以降(公出)の売上まで含めて
// 段を判定していた。給与計算(calcTotalPay)は 12乗務以上のとき drives.slice(0,11) で
// 歩率を出しているので、ホームの表示だけが実際の給与と食い違っていた。
import { test } from 'node:test';
import assert from 'node:assert';
import { RATE_TIER_SHIFT_CAP, tierBasisDrives, tierBasisSalesExcl, calcTotalPay } from '../js/payroll.js';

const drive = (date, incl) => ({ date, totalSales: incl, vehicleType: 'japantaxi' }); // 合計のみ入力(概算)
// 11出番で 660,000円(税込) = 600,000円(税抜)、12出番目に 110,000円(税込)を足す
const eleven = Array.from({ length: 11 }, (_, i) => drive(`2026-09-${String(i + 1).padStart(2, '0')}`, 60000));
const thirteen = [...eleven, drive('2026-09-12', 110000), drive('2026-09-13', 110000)];

test('段の基準になる出番は11まで', () => {
  assert.equal(RATE_TIER_SHIFT_CAP, 11);
  assert.equal(tierBasisDrives(thirteen).length, 11);
  assert.deepEqual(tierBasisDrives(eleven), eleven, '11以下はそのまま');
});

test('12出番目以降の売上は段の判定に入れない', () => {
  const only11 = tierBasisSalesExcl(eleven);
  const with13 = tierBasisSalesExcl(thirteen);
  assert.equal(Math.round(with13), Math.round(only11), '13出番あっても11出番ぶんの売上');
  assert.equal(Math.round(only11), Math.round(660000 / 1.1));
});

test('空・未入力でも落ちない', () => {
  assert.equal(tierBasisSalesExcl([]), 0);
  assert.equal(tierBasisSalesExcl(null), 0);
  assert.deepEqual(tierBasisDrives(null), []);
});

test('給与計算が使う歩率と、段の基準売上が一致する', () => {
  // calcTotalPay は 12乗務以上で drives.slice(0,11) から歩率を出す。
  // ホーム表示もこれと同じ売上で段を選ぶ必要がある。
  const config = {
    payrollMode: 'tiered',
    responsibilityShifts: 11,
    rateTable: { '11': [{ salesMin: 0, salesMax: 600000, rate: 0.5 }, { salesMin: 600000, salesMax: 700000, rate: 0.6 }, { salesMin: 700000, salesMax: Infinity, rate: 0.65 }], '12_13rate': 0.62 },
    shifts: { expandedDates: [], paidLeaveDates: [] },
  };
  const r = calcTotalPay(thirteen, config, '2026-09-01', '2026-09-30');
  assert.equal(r.breakdown.mode, 'tiered_12_or_more');
  assert.equal(Math.round(r.breakdown.salesExclTax11), Math.round(tierBasisSalesExcl(thirteen)));
  assert.equal(r.rate, 0.6, '11出番ぶん60万で 0.6。13出番ぶん(80万)なら 0.65 になってしまう');
});

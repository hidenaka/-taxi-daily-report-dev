import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { calcTotalPay, simulateMonthlyWithAvg, simulateMonthlySplit } from '../js/payroll.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';

const S = '2026-05-01', E = '2026-05-31';
const drives = [1, 2, 3].map(d => ({ date: `2026-05-0${d}`, vehicleType: 'japantaxi', trips: [{ amount: 60000, isCancel: false }] }));
const remaining = Array.from({ length: 8 }, () => ({ vehicleType: 'japantaxi' }));

test('simulateMonthlyWithAvg: 残り乗務を一律の平均で埋めた正式計算と一致する', () => {
  const sim = Array.from({ length: 8 }, (_, i) => ({ date: '_x' + i, vehicleType: 'japantaxi', trips: [{ amount: 70000, isCancel: false }] }));
  const want = calcTotalPay([...drives, ...sim], DEFAULT_CONFIG, S, E);
  const got = simulateMonthlyWithAvg(drives, remaining, DEFAULT_CONFIG, S, E, 70000);
  assert.equal(got.total, want.total);
  assert.equal(got.rate, want.rate);
});

test('simulateMonthlyWithAvg: 平均を上げると月給は下がらず、歩率も下がらない', () => {
  let prev = null;
  for (let avg = 0; avg <= 120000; avg += 5000) {
    const r = simulateMonthlyWithAvg(drives, remaining, DEFAULT_CONFIG, S, E, avg);
    if (prev) { assert.ok(r.total >= prev.total); assert.ok(r.rate >= prev.rate); }
    prev = r;
  }
});

test('ホームの歩率欄に「残りの平均を動かして試す」バーがある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="rateSim\$\{key\}" class="rate-sim-range" type="range"/);
  assert.match(html, /bar\('To11'/);
  assert.match(html, /bar\('After'/);
  assert.match(html, /if \(!isPast && remainingShifts > 0\) \{/);
  assert.match(html, /\$\{rateSimHtml\}\$\{nextTierHtml\}/);
  assert.match(html, /innerHTML = summaryHtml;\n  bindRateSim\(\);/);
});

test('simulateMonthlySplit: 11出番目までと12出番目以降を別の平均で計算する', () => {
  const rem10 = Array.from({ length: 10 }, () => ({ vehicleType: 'japantaxi' })); // 3+10=13出番
  const a = simulateMonthlySplit(drives, rem10, DEFAULT_CONFIG, S, E, 66000, 0);
  const b = simulateMonthlySplit(drives, rem10, DEFAULT_CONFIG, S, E, 66000, 55000);
  // 12・13出番目を動かしても歩率(11出番目までで決まる)は変わらない
  assert.equal(a.rate, b.rate);
  // 12・13出番目の2出番 × 55000円(税込) → 税抜 × 12_13rate だけ増える
  const extra = DEFAULT_CONFIG.rateTable['12_13rate'];
  assert.ok(Math.abs((b.total - a.total) - 2 * (55000 / 1.1) * extra) < 1);
  assert.equal(b.breakdown.extras.length, 2);
  // 一律の平均は両方同じ値の分け方と一致
  assert.equal(simulateMonthlyWithAvg(drives, rem10, DEFAULT_CONFIG, S, E, 60000).total,
    simulateMonthlySplit(drives, rem10, DEFAULT_CONFIG, S, E, 60000, 60000).total);
});

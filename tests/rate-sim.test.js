import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { calcTotalPay, simulateMonthlyWithAvg } from '../js/payroll.js';
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
  assert.match(html, /id="rateSimRange" type="range"/);
  assert.match(html, /\$\{rateSimHtml\}\$\{nextTierHtml\}/);
  assert.match(html, /innerHTML = summaryHtml;\n  bindRateSim\(\);/);
});

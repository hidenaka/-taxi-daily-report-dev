import { test, assert } from './run.js';
import { calcDailySales, calcMonthlySales, findRate, calcBasePay, calcIncentive, calcTotalPay, requiredUniformSales } from '../js/payroll.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';

test('calcDailySales: trips のキャンセル除いた合計（税込）', () => {
  const drive = {
    trips: [
      { amount: 1000, isCancel: false },
      { amount: 6300, isCancel: false },
      { amount: 0, isCancel: true },     // キャンセルは除外
      { amount: 2000, isCancel: false }
    ]
  };
  assert.equal(calcDailySales(drive).inclTax, 9300);
  assert.equal(calcDailySales(drive).exclTax, 9300 / 1.1);
});

test('calcMonthlySales: drives全体の合計', () => {
  const drives = [
    { trips: [{ amount: 50000, isCancel: false }] },
    { trips: [{ amount: 60000, isCancel: false }, { amount: 500, isCancel: true }] }
  ];
  const result = calcMonthlySales(drives);
  assert.equal(result.inclTax, 110000);
  assert.equal(result.exclTax, 110000 / 1.1);
  assert.equal(result.shiftCount, 2);
});

test('findRate: 売上ティアからrateを引く', () => {
  const tiers = [
    { salesMin: 0, salesMax: 500000, rate: 0.55 },
    { salesMin: 500000, salesMax: 1000000, rate: 0.62 },
    { salesMin: 1000000, salesMax: 2000000, rate: 0.687 }
  ];
  assert.equal(findRate(tiers, 300000), 0.55);
  assert.equal(findRate(tiers, 700000), 0.62);
  assert.equal(findRate(tiers, 1100000), 0.687);
});

test('findRate: テーブル外（最大超）→最大ティアの率', () => {
  const tiers = [
    { salesMin: 0, salesMax: 500000, rate: 0.55 },
    { salesMin: 500000, salesMax: 1000000, rate: 0.62 }
  ];
  assert.equal(findRate(tiers, 2000000), 0.62);
});

test('calcBasePay: 11乗務、売上1,100,000(税抜) → 歩率68.7% → 755,700', () => {
  const drives = Array(11).fill({ trips: [{ amount: 110000, isCancel: false }] });
  // 11乗務×110,000(税込) = 1,210,000(税込) = 1,100,000(税抜)
  const config = {
    rateTable: {
      "11": [
        { salesMin: 0, salesMax: 500000, rate: 0.55 },
        { salesMin: 500000, salesMax: 1000000, rate: 0.62 },
        { salesMin: 1000000, salesMax: 2000000, rate: 0.687 }
      ],
      "12_13rate": 0.62
    }
  };
  const result = calcBasePay(drives, config);
  // 1,100,000 × 0.687 = 755,700
  assert.equal(Math.round(result.basePay), 755700);
  assert.equal(result.rate, 0.687);
  assert.equal(result.shiftCount, 11);
});

test('calcBasePay: 13乗務、各日税込110,000 → 11乗務まで税抜1,100,000で歩率0.687、12-13乗務目は税抜100,000×0.62×2', () => {
  const drives = Array(13).fill({ trips: [{ amount: 110000, isCancel: false }] });
  // 各日 110,000(税込) = 100,000(税抜)、13乗務
  const config = {
    rateTable: {
      "11": [
        { salesMin: 0, salesMax: 500000, rate: 0.55 },
        { salesMin: 500000, salesMax: 1000000, rate: 0.62 },
        { salesMin: 1000000, salesMax: 2000000, rate: 0.687 }
      ],
      "12_13rate": 0.62
    }
  };
  const result = calcBasePay(drives, config);
  // 11乗務まで: 11 × 110,000(税込) = 1,210,000(税込) → 1,100,000(税抜) × 0.687 = 755,700
  // 12-13乗務: 100,000(税抜) × 2 × 0.62 = 124,000
  // 合計: 879,700
  assert.equal(Math.round(result.basePay), 879700);
  assert.equal(result.shiftCount, 13);
});

test('calcIncentive: プレミアム車両で税抜80,000円超の日 → 1乗務2,000円', () => {
  const drives = [
    { vehicleType: 'premium', trips: [{ amount: 99000, isCancel: false }] },  // 90,000税抜 > 80,000 → 加算
    { vehicleType: 'premium', trips: [{ amount: 80000, isCancel: false }] },  // 約72,727税抜 → 加算なし
    { vehicleType: 'japantaxi', trips: [{ amount: 110000, isCancel: false }] }  // ジャパンタクシー → 加算なし
  ];
  const config = {
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 }
  };
  assert.equal(calcIncentive(drives, config), 2000);
});

test('calcTotalPay: basePay + incentive', () => {
  const drives = Array(11).fill({ vehicleType: 'japantaxi', trips: [{ amount: 110000, isCancel: false }] });
  const config = {
    rateTable: {
      "11": [
        { salesMin: 0, salesMax: 500000, rate: 0.55 },
        { salesMin: 500000, salesMax: 1000000, rate: 0.62 },
        { salesMin: 1000000, salesMax: 2000000, rate: 0.687 }
      ],
      "12_13rate": 0.62
    },
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 }
  };
  const result = calcTotalPay(drives, config);
  assert.equal(Math.round(result.basePay), 755700);
  assert.equal(result.incentive, 0);
  assert.equal(Math.round(result.total), 755700);
});

test('requiredUniformSales: 残り乗務0なら0を返す', () => {
  assert.equal(
    requiredUniformSales([], [], DEFAULT_CONFIG, '2026-05-01', '2026-05-31', 500000, 0.75),
    0
  );
});

test('requiredUniformSales: 既に達成済みなら0を返す', () => {
  // 11乗務×税込30万 = 十分な売上 → 目標1万は達成済み
  const drives = Array.from({ length: 11 }, (_, i) => ({
    trips: [{ amount: 300000, isCancel: false }], vehicleType: 'japantaxi', date: '2026-05-' + String(i + 1).padStart(2, '0')
  }));
  assert.equal(
    requiredUniformSales(drives, [{ vehicleType: 'japantaxi' }], DEFAULT_CONFIG, '2026-05-01', '2026-05-31', 10000, 0.75),
    0
  );
});

test('requiredUniformSales: 段階歩率を反映し、逆算結果で目標手取りちょうどになる', () => {
  const target = 500000, takeHomeRate = 0.75;
  const remaining = Array.from({ length: 12 }, () => ({ vehicleType: 'japantaxi' }));
  const x = requiredUniformSales([], remaining, DEFAULT_CONFIG, '2026-05-01', '2026-05-31', target, takeHomeRate);
  // x(税込)を12乗務に適用 → 手取りが target に一致(1円未満精度)
  const drives = remaining.map((s, i) => ({
    trips: [{ amount: x, isCancel: false }], vehicleType: s.vehicleType, date: '_t' + i
  }));
  const takeHome = calcTotalPay(drives, DEFAULT_CONFIG, '2026-05-01', '2026-05-31').total * takeHomeRate;
  assert.ok(Math.abs(takeHome - target) < 1, `takeHome=${takeHome} should ≈ ${target}`);
  // 一律0.65割り戻しの旧推定(税込¥94,017)より少ない必要売上になる
  assert.ok(x < 94017, `x=${x} should be below the old flat-rate estimate 94017`);
});

test('requiredUniformSales: プレミアム車のインセンティブを考慮する(必要売上が下がる)', () => {
  const target = 500000, takeHomeRate = 0.75;
  const allJt = Array.from({ length: 12 }, () => ({ vehicleType: 'japantaxi' }));
  const allPremium = Array.from({ length: 12 }, () => ({ vehicleType: 'premium' }));
  const xJt = requiredUniformSales([], allJt, DEFAULT_CONFIG, '2026-05-01', '2026-05-31', target, takeHomeRate);
  const xPremium = requiredUniformSales([], allPremium, DEFAULT_CONFIG, '2026-05-01', '2026-05-31', target, takeHomeRate);
  // プレミアムは1乗務+2,000円のインセンティブが付くため、必要売上はJTより少なくて済む
  assert.ok(xPremium < xJt, `xPremium=${xPremium} should be < xJt=${xJt}`);
});

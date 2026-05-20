import { extractInclTaxFare } from './summary-drive.js';

const TAX_RATE = 1.1;

// 日次売上の計算。明細日報なら trips 集計、合計のみ日報なら summaryFare 直接（decisions 8）。
export function calcDailySales(drive) {
  const inclTax = extractInclTaxFare(drive);
  return {
    inclTax,
    exclTax: inclTax / TAX_RATE
  };
}

export function calcMonthlySales(drives) {
  let inclTax = 0;
  for (const drive of drives) {
    inclTax += calcDailySales(drive).inclTax;
  }
  return {
    inclTax,
    exclTax: inclTax / TAX_RATE,
    shiftCount: drives.length
  };
}

export function findRate(tiers, salesExclTax) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    console.warn('findRate: tiers is not a valid array, using fallback rate 0.6');
    return 0.6;
  }
  for (const tier of tiers) {
    if (salesExclTax >= tier.salesMin && salesExclTax < tier.salesMax) {
      return tier.rate;
    }
  }
  // 範囲外（最大超）→最大ティアの率
  return tiers[tiers.length - 1].rate;
}

// 現在の累計(税抜)が属するティアの index を返す。範囲外（最大超）→末尾
export function findTierIdx(tiers, salesExclTax) {
  if (!Array.isArray(tiers) || tiers.length === 0) return -1;
  for (let i = 0; i < tiers.length; i++) {
    if (salesExclTax >= tiers[i].salesMin && salesExclTax < tiers[i].salesMax) return i;
  }
  return tiers.length - 1;
}

// 現ティアより rate が高い直近の上位ティア（売上を増やす方向に進んで最初に出会う高 rate ティア）
export function findNextHigherRateTier(tiers, currentIdx) {
  if (!Array.isArray(tiers) || currentIdx < 0 || currentIdx >= tiers.length) return null;
  const currentRate = tiers[currentIdx].rate;
  for (let i = currentIdx + 1; i < tiers.length; i++) {
    if (tiers[i].rate > currentRate) return { tier: tiers[i], idx: i };
  }
  return null;
}

// 現ティアより rate が低い直近の上位ティア（売上を増やす方向に進んで最初に出会う低 rate ティア = 越えると歩率が下がる境界）
export function findNextLowerRateTier(tiers, currentIdx) {
  if (!Array.isArray(tiers) || currentIdx < 0 || currentIdx >= tiers.length) return null;
  const currentRate = tiers[currentIdx].rate;
  for (let i = currentIdx + 1; i < tiers.length; i++) {
    if (tiers[i].rate < currentRate) return { tier: tiers[i], idx: i };
  }
  return null;
}

function getRateTable(config) {
  if (!config || typeof config !== 'object') return null;
  if (config.rateTable && typeof config.rateTable === 'object') return config.rateTable;
  return null;
}

export function calcBasePay(drives, config, options = {}) {
  const shiftCount = drives.length;
  const respShifts = config.responsibilityShifts || 11;

  // 固定歩率モード
  if (config.payrollMode === 'fixed_rate') {
    const monthly = calcMonthlySales(drives);
    const rate = config.fixedRate || 0.55;
    return {
      basePay: monthly.exclTax * rate,
      rate,
      shiftCount,
      extraRate: null,
      breakdown: {
        mode: 'fixed_rate',
        salesExclTax: monthly.exclTax,
        rate,
        basePay: monthly.exclTax * rate
      }
    };
  }

  // 変動歩率モード(既存)
  const rateTable = getRateTable(config);

  if (!rateTable) {
    console.warn('calcBasePay: rateTable missing, using fallback');
    const monthly = calcMonthlySales(drives);
    return {
      basePay: monthly.exclTax * 0.6,
      rate: 0.6,
      shiftCount,
      breakdown: {
        mode: 'fallback',
        salesExclTax: monthly.exclTax,
        rate: 0.6,
        basePay: monthly.exclTax * 0.6
      }
    };
  }

  if (shiftCount <= 11) {
    const monthly = calcMonthlySales(drives);
    // useResponsibilityTier: 予定責任出番(respShifts)ベースでティア表を選ぶ
    // 例: shiftCount=10, respShifts=11 → rateTable["11"]を使う(途中段階の暫定計算用)
    // デフォルト false → 実shiftCountベース(過去月の実績計算用、互換性維持)
    const tierKey = options.useResponsibilityTier
      ? String(Math.min(respShifts, 11))
      : String(shiftCount);
    const tiers = rateTable[tierKey] || rateTable["11"];
    const rate = findRate(tiers, monthly.exclTax);
    const basePay = monthly.exclTax * rate;
    return {
      basePay,
      rate,
      shiftCount,
      breakdown: {
        mode: 'tiered_11_or_less',
        tierKey,
        salesExclTax: monthly.exclTax,
        rate,
        basePay,
        extras: []
      }
    };
  }

  // 12乗務以上: 11乗務目までで歩率算出 + 12乗務目以降は固定率
  const drives11 = drives.slice(0, 11);
  const monthly11 = calcMonthlySales(drives11);
  const rate11 = findRate(rateTable["11"], monthly11.exclTax);
  const basePay11 = monthly11.exclTax * rate11;
  let basePay = basePay11;

  const extraRate = rateTable["12_13rate"] || 0.62;
  const extras = [];
  for (let i = 11; i < drives.length; i++) {
    const drive = drives[i];
    const daily = calcDailySales(drive);
    const addPay = daily.exclTax * extraRate;
    basePay += addPay;
    extras.push({
      shiftNo: i + 1,
      date: drive.date,
      salesExclTax: daily.exclTax,
      rate: extraRate,
      addPay
    });
  }

  return {
    basePay,
    rate: rate11,
    shiftCount,
    extraRate,
    breakdown: {
      mode: 'tiered_12_or_more',
      tierKey: '11',
      salesExclTax11: monthly11.exclTax,
      rate11,
      basePay11,
      extras,
      extraTotal: basePay - basePay11,
      basePay
    }
  };
}

export function calcIncentive(drives, config) {
  const { thresholdSalesExclTax, amountPerShift } = config.premiumIncentive;
  let total = 0;
  for (const drive of drives) {
    if (drive.vehicleType !== 'premium') continue;
    const daily = calcDailySales(drive);
    if (daily.exclTax > thresholdSalesExclTax) total += amountPerShift;
  }
  return total;
}

export function calcPaidLeavePay(config, periodStart, periodEnd) {
  const dates = config?.shifts?.paidLeaveDates || [];
  const inPeriod = dates.filter(d => d >= periodStart && d <= periodEnd);
  return {
    days: inPeriod.length,
    amount: inPeriod.length * (config.paidLeaveAmount || 0),
    dates: inPeriod
  };
}

export function calcTotalPay(drives, config, periodStart, periodEnd, options = {}) {
  const base = calcBasePay(drives, config, options);
  const incentive = calcIncentive(drives, config);
  const paidLeave = (periodStart && periodEnd)
    ? calcPaidLeavePay(config, periodStart, periodEnd)
    : { days: 0, amount: 0, dates: [] };
  return {
    ...base,
    incentive,
    paidLeaveDays: paidLeave.days,
    paidLeaveAmount: paidLeave.amount,
    total: base.basePay + incentive + paidLeave.amount
  };
}

// 残りの乗務すべてで一律 X 円(税込)稼いだとき、月度手取りが目標ちょうどに
// なる X を二分探索で求める。割り戻し(一律歩率で除算)ではなく実際の給与計算
// calcTotalPay を使うため、段階歩率(1〜11乗務目)・12乗務目以降の固定率
// (rateTable["12_13rate"])・プレミアムインセンティブを正しく反映する。
//
//   actualDrives   : 入力済みの実乗務(配列)
//   remainingShifts: 残り乗務の車種リスト [{ vehicleType }]
//   targetTakeHome : 目標手取り額
//   takeHomeRate   : 手取り率(総支給→手取り)
// 戻り値: 1乗務あたり必要売上(税込)。達成済み・残り乗務0なら 0。
export function requiredUniformSales(actualDrives, remainingShifts, config, periodStart, periodEnd, targetTakeHome, takeHomeRate) {
  if (!Array.isArray(remainingShifts) || remainingShifts.length === 0) return 0;
  if (!(takeHomeRate > 0)) return 0;

  const takeHomeOf = (inclTaxPerShift) => {
    const sim = remainingShifts.map((s, i) => ({
      trips: [{ amount: inclTaxPerShift, isCancel: false }],
      vehicleType: (s && s.vehicleType) ? s.vehicleType : 'japantaxi',
      date: '_req_' + i
    }));
    const drives = [...(actualDrives || []), ...sim];
    return calcTotalPay(drives, config, periodStart, periodEnd).total * takeHomeRate;
  };

  // 既に達成済み
  if (takeHomeOf(0) >= targetTakeHome) return 0;

  // 目標到達まで上限を拡張
  let hi = 100000;
  let guard = 0;
  while (takeHomeOf(hi) < targetTakeHome && guard++ < 40) hi *= 2;

  // 二分探索(税込・1円未満精度まで)
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (takeHomeOf(mid) < targetTakeHome) lo = mid; else hi = mid;
  }
  return hi;
}

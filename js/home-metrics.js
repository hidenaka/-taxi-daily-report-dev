// js/home-metrics.js
// ホーム「あなたの数値」カードの算出。責任出番(1〜11)と公出(12〜)を必ず分離する。
// 算出は payroll.js の純関数を再利用し、表示用の値のみを返す（DOM非依存）。
import { calcDailySales, requiredUniformSales, calcTotalPay, predictMonthly } from './payroll.js';

// 責任出番の上限（法律上11。12以降は公出＝固定歩率）
export const RESP_CAP = 11;

// drives(日付昇順前提)を 責任(1〜11) と 公出(12〜) に分割
export function splitDrives(drives) {
  const arr = Array.isArray(drives) ? drives : [];
  return { resp: arr.slice(0, RESP_CAP), kosyutsu: arr.slice(RESP_CAP) };
}

// 売上集計: 合計(税込/税抜)・平均(税込/税抜)・出番数
export function salesAggregate(subset) {
  const arr = Array.isArray(subset) ? subset : [];
  const totalIncl = arr.reduce((s, d) => s + calcDailySales(d).inclTax, 0);
  const totalExcl = totalIncl / 1.1;
  const count = arr.length;
  return {
    count,
    totalIncl,
    totalExcl,
    avgIncl: count ? totalIncl / count : 0,
    avgExcl: count ? totalExcl / count : 0,
  };
}

// 責任出番(11)まで残りで、目標到達に必要な「1出番あたり均等(税込/税抜)」と総額。
// 目標は takeHomeAt11Target があればそれ、無ければ takeHomeTarget(手取り月度)。
// 残出番の車種は現状のプレミアム比率を踏襲(予測と前提統一)。
export function requiredToRespCap(drives, config, periodStart, periodEnd) {
  const arr = Array.isArray(drives) ? drives : [];
  const remaining = Math.max(0, RESP_CAP - arr.length);
  const target = (config.takeHomeAt11Target > 0)
    ? config.takeHomeAt11Target
    : (config.takeHomeTarget || 0);
  const takeHomeRate = config.takeHomeRate || 0.75;
  if (remaining <= 0 || !(target > 0) || !(takeHomeRate > 0) || arr.length === 0) {
    return { remaining, perShiftIncl: 0, perShiftExcl: 0, totalIncl: 0, totalExcl: 0, target };
  }
  const premiumCount = arr.filter(d => d.vehicleType === 'premium').length;
  const premiumRemaining = Math.round(remaining * (premiumCount / arr.length));
  const remainingShiftList = Array.from({ length: remaining }, (_, i) => ({
    vehicleType: i < premiumRemaining ? 'premium' : 'japantaxi'
  }));
  const perShiftIncl = requiredUniformSales(
    arr, remainingShiftList, config, periodStart, periodEnd, target, takeHomeRate, 'takehome'
  );
  const perShiftExcl = perShiftIncl / 1.1;
  return {
    remaining, target,
    perShiftIncl, perShiftExcl,
    totalIncl: perShiftIncl * remaining,
    totalExcl: perShiftExcl * remaining,
  };
}

// breakdown から責任出番ぶん(11まで)の基本給を取り出す
function base11Pay(bd) {
  if (!bd) return 0;
  return bd.mode === 'tiered_12_or_more' ? (bd.basePay11 || 0) : (bd.basePay || 0);
}

// 目標連動データを組む(案A: 目標未設定なら hasTarget=false・素の数値)
function withTarget(landing, current, targetVal) {
  if (targetVal > 0) {
    const diff = landing - targetVal;
    return { value: landing, current, hasTarget: true, target: targetVal, diff, willHit: diff >= 0 };
  }
  return { value: landing, current, hasTarget: false };
}

// 月度/責任/公出の着地値＋目標連動データ
export function computeLandings(drives, config, periodStart, periodEnd, plannedShifts) {
  const takeHomeRate = config.takeHomeRate || 0.75;
  const actual = calcTotalPay(drives, config, periodStart, periodEnd, { useResponsibilityTier: true });
  const predicted = (drives.length > 0 && drives.length < plannedShifts)
    ? predictMonthly(drives, config, periodStart, periodEnd, plannedShifts)
    : actual;

  const aBd = actual.breakdown, pBd = predicted.breakdown;
  const respLandTH = base11Pay(pBd) * takeHomeRate;
  const respCurTH = base11Pay(aBd) * takeHomeRate;
  const kosyuLandTH = ((pBd && pBd.extraTotal) || 0) * takeHomeRate;
  const kosyuCurTH = ((aBd && aBd.extraTotal) || 0) * takeHomeRate;

  return {
    month: {
      gross: withTarget(predicted.total, actual.total, config.grossTarget || 0),
      takehome: withTarget(predicted.total * takeHomeRate, actual.total * takeHomeRate, config.takeHomeTarget || 0),
      rate: predicted.rate || actual.rate || 0,
    },
    resp: {
      takehome: withTarget(respLandTH, respCurTH, config.takeHomeAt11Target || 0),
    },
    kosyutsu: {
      reaches: !!(pBd && pBd.mode === 'tiered_12_or_more'),
      takehome: withTarget(kosyuLandTH, kosyuCurTH, config.takeHomeAfter11Target || 0),
    },
  };
}

// 選べる数値のカタログ。group: resp(1〜11責任) / kosyutsu(12〜公出) / month(月度全体)
// tax: 'incl' | 'excl' | null(税種なし)。pair: 税込/税抜が対になるなら基底キー。
// targetField: 設定の目標フィールド名(あれば目標連動の対象)。
export const METRIC_CATALOG = [
  { id: 'resp.total.incl',  group: 'resp', label: '11出番までの合計売上', tax: 'incl', pair: 'resp.total' },
  { id: 'resp.total.excl',  group: 'resp', label: '11出番までの合計売上', tax: 'excl', pair: 'resp.total' },
  { id: 'resp.avg.incl',    group: 'resp', label: '11出番までの平均売上', tax: 'incl', pair: 'resp.avg' },
  { id: 'resp.avg.excl',    group: 'resp', label: '11出番までの平均売上', tax: 'excl', pair: 'resp.avg' },
  { id: 'resp.needTotal.incl', group: 'resp', label: '残り(11まで)で必要な総売上', tax: 'incl', pair: 'resp.needTotal' },
  { id: 'resp.needTotal.excl', group: 'resp', label: '残り(11まで)で必要な総売上', tax: 'excl', pair: 'resp.needTotal' },
  { id: 'resp.needPer.incl', group: 'resp', label: '残り・1出番あたり均等', tax: 'incl', pair: 'resp.needPer' },
  { id: 'resp.needPer.excl', group: 'resp', label: '残り・1出番あたり均等', tax: 'excl', pair: 'resp.needPer' },
  { id: 'resp.takehome',    group: 'resp', label: '11出番までの手取り', tax: null, targetField: 'takeHomeAt11Target' },
  { id: 'kosyutsu.total.incl', group: 'kosyutsu', label: '公出ぶんの合計売上', tax: 'incl', pair: 'kosyutsu.total' },
  { id: 'kosyutsu.total.excl', group: 'kosyutsu', label: '公出ぶんの合計売上', tax: 'excl', pair: 'kosyutsu.total' },
  { id: 'kosyutsu.avg.incl',   group: 'kosyutsu', label: '公出ぶんの平均売上', tax: 'incl', pair: 'kosyutsu.avg' },
  { id: 'kosyutsu.avg.excl',   group: 'kosyutsu', label: '公出ぶんの平均売上', tax: 'excl', pair: 'kosyutsu.avg' },
  { id: 'kosyutsu.takehome',   group: 'kosyutsu', label: '公出ぶんの手取り', tax: null, targetField: 'takeHomeAfter11Target' },
  { id: 'month.gross',     group: 'month', label: '月度予想 総支給(着地)', tax: null, targetField: 'grossTarget' },
  { id: 'month.takehome',  group: 'month', label: '月度予想 手取り(着地)', tax: null, targetField: 'takeHomeTarget' },
  { id: 'month.total.incl',group: 'month', label: '月度合計 営収', tax: 'incl', pair: 'month.total' },
  { id: 'month.total.excl',group: 'month', label: '月度合計 営収', tax: 'excl', pair: 'month.total' },
  { id: 'month.rate',      group: 'month', label: '着地歩率', tax: null },
];

export const METRIC_GROUPS = [
  { key: 'resp', label: '責任出番（1〜11）', accent: '#1565c0', bg: '#e3f2fd' },
  { key: 'kosyutsu', label: '公出（12出番目〜）', accent: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'month', label: '月度全体', accent: '#2e7d32', bg: '#ecfdf5' },
];

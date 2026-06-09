// js/home-metrics.js
// ホーム「あなたの数値」カードの算出。責任出番(1〜11)と公出(12〜)を必ず分離する。
// 算出は payroll.js の純関数を再利用し、表示用の値のみを返す（DOM非依存）。
import { calcDailySales, requiredUniformSales } from './payroll.js';

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

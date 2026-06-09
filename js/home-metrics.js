// js/home-metrics.js
// ホーム「あなたの数値」カードの算出。責任出番(1〜11)と公出(12〜)を必ず分離する。
// 算出は payroll.js の純関数を再利用し、表示用の値のみを返す（DOM非依存）。
import { calcDailySales } from './payroll.js';

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

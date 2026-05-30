// グループ匿名プール用の純ロジック。
// drive/trip を「身元なし・エリア粗化済みの個別乗車(pool item)」へ変換する。
// 1日(drive)単位でまとめず trip 単位のバラに落とす（仕様 §4.1：1日まとめ＝個人合計の復元を防ぐ）。
// 副作用なし・I/Oなし。後続の Worker がこの関数群でプールを構築する。
import { extractArea } from './chart-helpers.js';

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 1 trip → 匿名 pool item。共有不可なものは null。
//  除外: キャンセル(isCancel) / type が 'trip' 以外(休憩等)
//  含める: boardTime / pickupArea / dropoffArea / km / amount / isPickup(迎車)
//  含めない: userId / メモ / 生の boardPlace(丁目まで) / pickupKind / no
export function tripToPoolItem(trip) {
  if (!trip || trip.isCancel) return null;
  // type が 'trip' 以外(休憩等)は除外。type 未設定の旧/簡易データは trip とみなして通す。
  if (trip.type && trip.type !== 'trip') return null;
  return {
    boardTime: trip.boardTime || null,
    pickupArea: extractArea(trip.boardPlace || '') || null,
    dropoffArea: extractArea(trip.alightPlace || '') || null,
    km: numOrNull(trip.km),
    amount: numOrNull(trip.amount),
    isPickup: !!trip.isPickup,
  };
}

// 1 drive → pool items[]。shareOptOut の日は空。trips 以外は無視。
export function driveToPoolItems(drive) {
  if (!drive || drive.shareOptOut) return [];
  const trips = Array.isArray(drive.trips) ? drive.trips : [];
  return trips.map(tripToPoolItem).filter(Boolean);
}

// drives[] → 全 pool items[]（trip単位のバラ。日付/userIdに紐付かない）。
export function buildPoolItems(drives) {
  if (!Array.isArray(drives)) return [];
  return drives.flatMap(driveToPoolItems);
}

// 合計のみ日報（明細を持たず合計金額だけで登録する drive doc）の純関数。
// decisions 8: シンプル500円プラン（明細が紙で出ない会社向け）で利用する。
//
// データスキーマ:
//   drive.summaryOnly: true              ─ 合計のみ登録フラグ
//   drive.summaryFare: number            ─ 税込合計売上（円）
//   drive.trips: []                      ─ 空配列で OK（既存ロジック互換）
//   その他既存フィールド（date, vehicleType, departureTime, returnTime,
//   totalDistanceKm, memo, weather, violations, createdAt, updatedAt）は保持
//
// 既存の明細日報との見分け方:
//   - summaryOnly === true なら合計のみ日報
//   - 売上は drive.summaryFare 直接値（trips は無視）
//   - false / undefined なら従来通り trips を集計

// 合計のみ日報の判定（純関数）
export function isSummaryDrive(drive) {
  return !!(drive && drive.summaryOnly === true);
}

// 税込合計売上を取得する純関数。
// summaryOnly なら summaryFare 直接、それ以外は trips の amount 合計（キャンセル除外）。
export function extractInclTaxFare(drive) {
  if (!drive) return 0;
  if (isSummaryDrive(drive)) {
    const v = Number(drive.summaryFare);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }
  const trips = Array.isArray(drive.trips) ? drive.trips : [];
  return trips
    .filter(t => t && !t.isCancel)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

// 合計のみ日報を組み立てる純関数（input.html から呼ぶ）
// fields: { date, vehicleType, departureTime, returnTime, totalDistanceKm, memo, summaryFare, weather?, violations?, createdAt?, updatedAt?, now? }
export function buildSummaryDrive(fields = {}) {
  const fare = Number(fields.summaryFare);
  const validFare = Number.isFinite(fare) && fare >= 0 ? Math.round(fare) : 0;
  const ts = fields.now || new Date().toISOString();
  return {
    date: fields.date,
    vehicleType: fields.vehicleType,
    departureTime: fields.departureTime || null,
    returnTime: fields.returnTime || null,
    totalDistanceKm: Number.isFinite(fields.totalDistanceKm) ? fields.totalDistanceKm : null,
    memo: fields.memo || '',
    summaryOnly: true,
    summaryFare: validFare,
    trips: [],
    rests: [],
    weather: fields.weather || null,
    violations: fields.violations || [],
    createdAt: fields.createdAt || ts,
    updatedAt: fields.updatedAt || ts,
  };
}

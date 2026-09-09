// 「この日のまとめ」を作る。snapshot-arrivals.mjs（日次保存）と
// regen-day-summaries.mjs（過去ぶんの作り直し）の両方から使う。
//
// 遅れの数え方は tools/js/arrivals-data.js の delayMinutesOf と同じ規則:
// 実際に着いた時刻(actualTime)を優先し、無ければ到着予定(estimatedTime)。
// 確定後のデータは estimatedTime が定刻のまま残るため、estimatedTime を先に見ると
// ほぼ全便が「定刻」に見えてしまう（9/8 は 1便 と出ていたが実際は 193便）。
export const CARRIED_OVER_UNTIL_HOUR = 6;

// 24:00〜29:59 は「日をまたいだ時刻」の正しい書き方。30時以降は壊れたデータ
// (実データ 9/2 NH088 の到着予定 "39:20")なので受け取らない。
// これを素通ししていたため「最大 1240分遅れ」が出ていた。
export const MAX_HOUR = 30;

export const minutesOfDay = (t) => {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h >= MAX_HOUR) return null;
  const raw = h * 60 + Number(m[2]);
  return raw >= 1440 ? raw - 1440 : raw;
};

export const isPastMidnight = (t) => {
  if (!t) return false;
  const m = String(t).match(/^(\d{1,2}):/);
  return !!m && Number(m[1]) >= 24;
};

export function buildSummary(data) {
  const all = data.flights || [];
  const flights = all.filter((x) => x.status !== "欠航");
  let delayed15 = 0, delayed30 = 0, maxDelay = 0, maxDelayFlight = null;
  const overnight = [];
  for (const x of flights) {
    const s = minutesOfDay(x.scheduledTime);
    const eRaw = x.actualTime ?? x.estimatedTime;
    const e = minutesOfDay(eRaw);
    if (s == null || e == null) continue;
    const d = isPastMidnight(eRaw) ? (e + 1440) - s : e - s;
    if (d >= 15) delayed15++;
    if (d >= 30) delayed30++;
    if (d > maxDelay) {
      maxDelay = d;
      maxDelayFlight = { flightNumber: x.flightNumber, fromName: x.fromName, scheduledTime: x.scheduledTime, estimatedTime: eRaw, poolLane: x.poolLane ?? null, delayMin: d };
    }
    // 翌朝までに着くものだけ「今夜の持ち越し」。翌日昼に振り替わった便は別の話。
    if (isPastMidnight(eRaw) && e < CARRIED_OVER_UNTIL_HOUR * 60) {
      overnight.push({ flightNumber: x.flightNumber, fromName: x.fromName, scheduledTime: x.scheduledTime, estimatedTime: eRaw, poolLane: x.poolLane ?? null, delayMin: d });
    }
  }
  return {
    totalFlights: flights.length,
    cancelledCount: all.length - flights.length,
    delayed15, delayed30, maxDelay, maxDelayFlight,
    overnightFlights: overnight,
    dispatchEndedAt: null,
  };
}

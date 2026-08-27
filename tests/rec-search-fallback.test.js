// 次の営業先 推奨検索の段階フォールバック
// 背景: 表示期間(既定=直近6月度)＋降車時刻±1h だけで探すと、自分1人分のデータでは
//       「3件以上」に届くエリアがほとんど無く、結果テーブルが出ないまま履歴だけになる。
//       (本番実データ 345乗務で計測: 上位20エリア×7〜23時のうち出るのは19%)
//       → 足りないときは 時間帯 → 期間 の順に自動で広げる。
import { test } from 'node:test';
import assert from 'node:assert';
import { searchNextBoardStepwise, boardAreaStats, REC_MIN_SAMPLES } from '../js/chart-helpers.js';

// 「A区a町 で降ろす → wait分後に B区b町 で乗る」1往復だけの乗務を作る
function drive(date, hour, { from = '港区赤坂', to = '千代田区大手町', amount = 3000, min = 0 } = {}) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const nextH = String(hour + (min >= 40 ? 1 : 0)).padStart(2, '0');
  const nextM = String((min + 10) % 60).padStart(2, '0');
  return {
    date,
    trips: [
      { boardTime: '06:00', alightTime: `${hh}:${mm}`, boardPlace: '大田区北馬込1', alightPlace: from, amount: 5000 },
      { boardTime: `${nextH}:${nextM}`, alightTime: `${nextH}:59`, boardPlace: to, alightPlace: '新宿区西新宿1', amount },
    ],
  };
}

test('期間内・時刻ぴったりで足りる → 何も広げない', () => {
  const recent = [drive('2026-08-01', 10), drive('2026-08-02', 10), drive('2026-08-03', 10)];
  const r = searchNextBoardStepwise({
    recentDrives: recent, allDrives: recent, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.stepIndex, 0);
  assert.strictEqual(r.widened, false);
  assert.strictEqual(r.widenedLabel, '');
  assert.strictEqual(r.evaluated.length, 1);
  assert.strictEqual(r.evaluated[0].area, '千代田区大手町');
  assert.strictEqual(r.hourWindow, 1);
});

test('前後1時間では足りない → 前後2時間まで広げて足りる', () => {
  const recent = [drive('2026-08-01', 10), drive('2026-08-02', 10), drive('2026-08-03', 12)];
  const r = searchNextBoardStepwise({
    recentDrives: recent, allDrives: recent, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.stepIndex, 1);
  assert.strictEqual(r.widened, true);
  assert.strictEqual(r.hourWindow, 2);
  assert.strictEqual(r.scope, 'recent');
  assert.match(r.widenedLabel, /前後2時間/);
  assert.strictEqual(r.evaluated[0].count, 3);
});

test('表示期間では足りない → 過去すべての実績まで広げる', () => {
  const recent = [drive('2026-08-01', 10)];
  const older = [drive('2025-01-05', 10), drive('2025-01-06', 10), ...recent];
  const r = searchNextBoardStepwise({
    recentDrives: recent, allDrives: older, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.scope, 'all');
  assert.strictEqual(r.hourWindow, 1);
  assert.strictEqual(r.widened, true);
  assert.match(r.widenedLabel, /過去すべて/);
  assert.strictEqual(r.evaluated[0].count, 3);
  // 履歴フォールバックも同じ広げた母集団で引けるよう、採用した drives を返す
  assert.strictEqual(r.drives, older);
});

test('時間帯を外せば足りる場合は最後に時間帯なしまで広げる', () => {
  const older = [drive('2025-01-05', 3), drive('2025-01-06', 10), drive('2025-01-07', 17)];
  const r = searchNextBoardStepwise({
    recentDrives: [], allDrives: older, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.hourWindow, null);
  assert.strictEqual(r.scope, 'all');
  assert.match(r.widenedLabel, /時間帯/);
  assert.strictEqual(r.evaluated[0].count, 3);
});

test('どこまで広げても足りない → 最後の段を返し、結果は空(呼び出し側が履歴を出す)', () => {
  const one = [drive('2026-08-01', 10)];
  const r = searchNextBoardStepwise({
    recentDrives: one, allDrives: one, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.evaluated.length, 0);
  assert.strictEqual(r.exhausted, true);
  // 履歴フォールバックは一番広い母集団で出す
  assert.strictEqual(r.scope, 'all');
  assert.strictEqual(r.hourWindow, null);
});

test('全期間データが未ロードなら表示期間の段だけで完結する', () => {
  const recent = [drive('2026-08-01', 10), drive('2026-08-02', 12)];
  const r = searchNextBoardStepwise({
    recentDrives: recent, allDrives: null, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(r.scope, 'recent');
  assert.strictEqual(r.drives, recent);
  assert.strictEqual(r.exhausted, true);
});

test('近隣マップを渡すと近隣エリアの降車も母集団に入る', () => {
  const neighbors = { '港区赤坂': new Set(['港区六本木']) };
  const recent = [
    drive('2026-08-01', 10, { from: '港区六本木' }),
    drive('2026-08-02', 10, { from: '港区六本木' }),
    drive('2026-08-03', 10, { from: '港区六本木' }),
  ];
  const withN = searchNextBoardStepwise({
    recentDrives: recent, allDrives: recent, neighbors, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(withN.stepIndex, 0);
  assert.strictEqual(withN.evaluated.length, 1);

  const withoutN = searchNextBoardStepwise({
    recentDrives: recent, allDrives: recent, neighbors: null, area: '港区赤坂', hour: 10,
  });
  assert.strictEqual(withoutN.evaluated.length, 0);
});

test('複数エリア(GPS範囲モード)でも配列のまま扱える', () => {
  const recent = [
    drive('2026-08-01', 10, { from: '大田区上池台' }),
    drive('2026-08-02', 10, { from: '大田区上池台' }),
    drive('2026-08-03', 10, { from: '大田区北千束' }),
  ];
  const r = searchNextBoardStepwise({
    recentDrives: recent, allDrives: recent, neighbors: null,
    area: ['大田区上池台', '大田区北千束'], hour: 10,
  });
  assert.strictEqual(r.stepIndex, 0);
  assert.strictEqual(r.evaluated[0].count, 3);
});

test('採用の下限件数は従来どおり3件', () => {
  assert.strictEqual(REC_MIN_SAMPLES, 3);
});

// --- その町で「乗せた」実績の集計 ---
// 「近いのに候補に入っていない町」を出すとき、その町の実力を数字で添えるために使う。
// 実績がある＝良い、ではないので、件数と単価をそのまま見せて判断は本人に委ねる。

function boardDrive(date, rows) {
  return { date, trips: rows.map(([place, time, amount]) => ({
    boardPlace: place, boardTime: time, alightTime: time, alightPlace: '新宿区西新宿1', amount,
  })) };
}

test('乗せた場所ごとに件数と平均・中央単価を出す', () => {
  const drives = [
    boardDrive('2026-08-01', [['港区赤坂1', '10:00', 3000], ['港区赤坂2', '10:30', 5000]]),
    boardDrive('2026-08-02', [['港区赤坂3', '10:10', 4000]]),
  ];
  const s = boardAreaStats(drives);
  assert.strictEqual(s['港区赤坂'].count, 3);
  assert.strictEqual(s['港区赤坂'].avgSales, 4000);
  assert.strictEqual(s['港区赤坂'].medianSales, 4000);
});

test('時間帯で絞れる', () => {
  const drives = [boardDrive('2026-08-01', [['港区赤坂1', '10:00', 3000], ['港区赤坂2', '20:00', 9000]])];
  const all = boardAreaStats(drives);
  const morning = boardAreaStats(drives, 10, 1);
  assert.strictEqual(all['港区赤坂'].count, 2);
  assert.strictEqual(morning['港区赤坂'].count, 1);
  assert.strictEqual(morning['港区赤坂'].avgSales, 3000);
});

test('キャンセルと¥0は数えない', () => {
  const drives = [{ date: '2026-08-01', trips: [
    { boardPlace: '港区赤坂1', boardTime: '10:00', alightTime: '10:20', alightPlace: 'x', amount: 3000 },
    { boardPlace: '港区赤坂2', boardTime: '10:05', alightTime: '10:25', alightPlace: 'x', amount: 5000, isCancel: true },
    { boardPlace: '港区赤坂3', boardTime: '10:10', alightTime: '10:30', alightPlace: 'x', amount: 0 },
  ] }];
  assert.strictEqual(boardAreaStats(drives)['港区赤坂'].count, 1);
});

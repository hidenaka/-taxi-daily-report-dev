import { test, assert } from './run.js';
import { normalizeArrivals, detectTopics, BIG_DELAY_MIN, aggregateByOrigin } from '../tools/js/arrivals-data.js';

test('normalizeArrivals: "to be determined" estimatedTime を null にする', () => {
  const data = {
    flights: [
      { flightNumber: 'NH852', estimatedTime: 'to be determined', scheduledTime: '17:45' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].estimatedTime, null);
  assert.equal(data.flights[0].scheduledTime, '17:45');
});

test('normalizeArrivals: scheduledTime と actualTime も同様に正規化', () => {
  const data = {
    flights: [
      { scheduledTime: 'to be determined', estimatedTime: '20:00', actualTime: 'to be determined' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].scheduledTime, null);
  assert.equal(data.flights[0].estimatedTime, '20:00');
  assert.equal(data.flights[0].actualTime, null);
});

test('normalizeArrivals: 正常な時刻はそのまま', () => {
  const data = {
    flights: [
      { flightNumber: 'NH3852', estimatedTime: '20:45', scheduledTime: '20:45' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].estimatedTime, '20:45');
  assert.equal(data.flights[0].scheduledTime, '20:45');
});

test('normalizeArrivals: flights が空 / undefined でも落ちない', () => {
  assert.equal(normalizeArrivals({ flights: [] }).flights.length, 0);
  assert.equal(normalizeArrivals({}).flights, undefined);
  assert.equal(normalizeArrivals(null), null);
});

test('normalizeArrivals 後に "estimatedTime ?? scheduledTime" が機能する', () => {
  const data = {
    flights: [
      { flightNumber: 'NH852', estimatedTime: 'to be determined', scheduledTime: '17:45' }
    ]
  };
  normalizeArrivals(data);
  const f = data.flights[0];
  const displayTime = f.estimatedTime ?? f.scheduledTime ?? '--:--';
  assert.equal(displayTime, '17:45');
});

test('normalizeArrivals: status="不明" + 過去時刻 → "到着"', () => {
  // 現在 19:50 想定で、04:21 着の便は既に到着済みのはず
  const now = new Date('2026-05-14T19:50:00+09:00');
  const data = {
    flights: [
      { flightNumber: 'NH105', status: '不明', actualTime: null, estimatedTime: '04:21' }
    ]
  };
  normalizeArrivals(data, now);
  assert.equal(data.flights[0].status, '到着');
});

test('normalizeArrivals: status="不明" + 未来時刻 → "飛行中"', () => {
  // 現在 19:50 想定で、22:00 着の便はまだ飛行中
  const now = new Date('2026-05-14T19:50:00+09:00');
  const data = {
    flights: [
      { flightNumber: 'JL044', status: '不明', actualTime: null, estimatedTime: '22:00' }
    ]
  };
  normalizeArrivals(data, now);
  assert.equal(data.flights[0].status, '飛行中');
});

test('normalizeArrivals: status="不明" + estimatedTimeなし + scheduledTimeのみ → 比較に使う', () => {
  const now = new Date('2026-05-14T19:50:00+09:00');
  const data = {
    flights: [
      { flightNumber: 'X', status: '不明', actualTime: null, estimatedTime: null, scheduledTime: '06:00' }
    ]
  };
  normalizeArrivals(data, now);
  assert.equal(data.flights[0].status, '到着');
});

test('normalizeArrivals: status="不明" + 時刻全くなし → "飛行中"（フォールバック）', () => {
  const now = new Date('2026-05-14T19:50:00+09:00');
  const data = {
    flights: [
      { flightNumber: 'X', status: '不明', actualTime: null, estimatedTime: null, scheduledTime: null }
    ]
  };
  normalizeArrivals(data, now);
  assert.equal(data.flights[0].status, '飛行中');
});

test('normalizeArrivals: status="不明" + actualTime あり → "到着"', () => {
  const data = {
    flights: [
      { flightNumber: 'JL999', status: '不明', actualTime: '14:30', estimatedTime: '14:25' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].status, '到着');
});

test('normalizeArrivals: status="到着"/"欠航"/"遅延" はそのまま維持', () => {
  const data = {
    flights: [
      { status: '到着' },
      { status: '欠航' },
      { status: '遅延' }
    ]
  };
  normalizeArrivals(data);
  assert.equal(data.flights[0].status, '到着');
  assert.equal(data.flights[1].status, '欠航');
  assert.equal(data.flights[2].status, '遅延');
});

// --- detectTopics: 大幅遅延便の抽出 ---

test(`detectTopics: ${BIG_DELAY_MIN}分以上の遅延便だけ拾う`, () => {
  const flights = [
    { flightNumber: 'NH1', scheduledTime: '10:00', estimatedTime: '10:45' }, // 45分遅延 → 拾う
    { flightNumber: 'NH2', scheduledTime: '11:00', estimatedTime: '11:10' }, // 10分遅延 → 拾わない
    { flightNumber: 'NH3', scheduledTime: '12:00', estimatedTime: '12:30' }, // 30分遅延 → 拾う(境界)
  ];
  const topics = detectTopics(flights);
  assert.deepEqual(topics.map(t => t.flightNumber), ['NH1', 'NH3']);
  assert.equal(topics[0].delayMin, 45);
});

test('detectTopics: 到着済みの便は除外する', () => {
  const flights = [
    { flightNumber: 'NH4', scheduledTime: '09:00', estimatedTime: '10:00', status: '到着' },
  ];
  assert.equal(detectTopics(flights).length, 0);
});

test('detectTopics: estimatedTime 昇順に並ぶ', () => {
  const flights = [
    { flightNumber: 'LATE', scheduledTime: '14:00', estimatedTime: '15:00' },
    { flightNumber: 'EARLY', scheduledTime: '10:00', estimatedTime: '11:00' },
  ];
  assert.deepEqual(detectTopics(flights).map(t => t.flightNumber), ['EARLY', 'LATE']);
});

// --- aggregateByOrigin: 出発地別集計 ---

test('aggregateByOrigin: fromName 単位で集計し、配下に flights 配列を返す', () => {
  const f1 = { fromName: '伊丹', estimatedTaxiPax: 8,  status: '到着' };
  const f2 = { fromName: '伊丹', estimatedTaxiPax: 6,  status: '飛行中' };
  const f3 = { fromName: '関空', estimatedTaxiPax: 4,  status: '飛行中' };
  const f4 = { fromName: '札幌', estimatedTaxiPax: 10, status: '到着' };
  const result = aggregateByOrigin([f1, f2, f3, f4]);
  // 結果は totalEstimatedTaxiPax 降順: 伊丹(14) > 札幌(10) > 関空(4)
  assert.deepEqual(result, [
    { fromName: '伊丹', flightCount: 2, totalEstimatedTaxiPax: 14, flights: [f1, f2] },
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 10, flights: [f4] },
    { fromName: '関空', flightCount: 1, totalEstimatedTaxiPax: 4,  flights: [f3] },
  ]);
});

test('aggregateByOrigin: グループ内の便は estimatedTime || scheduledTime 昇順', () => {
  const fLate  = { fromName: '札幌', estimatedTaxiPax: 5, status: '到着', estimatedTime: '15:00' };
  const fEarly = { fromName: '札幌', estimatedTaxiPax: 4, status: '到着', estimatedTime: '08:00' };
  const fMid   = { fromName: '札幌', estimatedTaxiPax: 3, status: '到着', scheduledTime: '12:00' };
  const result = aggregateByOrigin([fLate, fEarly, fMid]);
  assert.deepEqual(result[0].flights, [fEarly, fMid, fLate]);
});

test('aggregateByOrigin: 欠航便は除外', () => {
  const fOk  = { fromName: '札幌', estimatedTaxiPax: 10, status: '到着' };
  const fCx  = { fromName: '札幌', estimatedTaxiPax: 5,  status: '欠航' };
  const result = aggregateByOrigin([fOk, fCx]);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 10, flights: [fOk] },
  ]);
});

test('aggregateByOrigin: estimatedTaxiPax が null/undefined のものは 0 扱い', () => {
  const fNull = { fromName: '札幌', estimatedTaxiPax: null,      status: '到着' };
  const fUdef = { fromName: '札幌', estimatedTaxiPax: undefined, status: '到着' };
  const fNum  = { fromName: '札幌', estimatedTaxiPax: 7,         status: '到着' };
  const result = aggregateByOrigin([fNull, fUdef, fNum]);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 3, totalEstimatedTaxiPax: 7, flights: [fNull, fUdef, fNum] },
  ]);
});

test('aggregateByOrigin: fromName が無い便はスキップ', () => {
  const fOk = { fromName: '札幌', estimatedTaxiPax: 5, status: '到着' };
  const fNullName = { fromName: null,   estimatedTaxiPax: 3, status: '到着' };
  const fNoName = { estimatedTaxiPax: 2, status: '到着' };
  const result = aggregateByOrigin([fOk, fNullName, fNoName]);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 5, flights: [fOk] },
  ]);
});

test('aggregateByOrigin: 空配列は空配列を返す', () => {
  assert.deepEqual(aggregateByOrigin([]), []);
});

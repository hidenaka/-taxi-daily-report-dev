import { test, assert } from './run.js';
import { normalizeArrivals, detectTopics, BIG_DELAY_MIN, listOriginOptions, filterByLane, detectArrivalGap, formatLaneDisplay, noticeNameToFlightNumber, applyNoticeOverrides, buildLaneNoticeMap, compareToTypical, buildNoribaActivity } from '../tools/js/arrivals-data.js';

// ロビー出(遅延込み)を15分ビンで見て、便がぐっと減る区間=到着の谷間/手薄 を検出。
const gf = (lobby, pax) => ({ lobbyExitTime: lobby, estimatedPax: pax, status: '到着予定' });

test('detectArrivalGap: 便が30分以上途切れる区間を gap として返す', () => {
  // 10:00台は便あり→10:15〜11:00は空→11:00便あり。now=10:00
  const flights = [gf('10:00', 1000), gf('10:05', 1000), gf('11:00', 1000)];
  const r = detectArrivalGap(flights, 600);
  assert.equal(r.kind, 'gap');
  assert.equal(r.startMin, 615); // 10:15
  assert.equal(r.endMin, 660);   // 11:00
  assert.equal(r.durationMin, 45);
});

test('detectArrivalGap: 単発の手薄枠は lull として返す', () => {
  // 全枠混むが12:30だけロビー出が激減(200)。now=12:00
  const flights = [gf('12:00', 1500), gf('12:15', 1500), gf('12:30', 200), gf('12:45', 1500), gf('13:00', 1500)];
  const r = detectArrivalGap(flights, 720);
  assert.equal(r.kind, 'lull');
  assert.equal(r.startMin, 750); // 12:30
  assert.equal(r.endMin, 765);   // 12:45
});

test('detectArrivalGap: 途切れず続くなら null', () => {
  const flights = [gf('12:00', 1500), gf('12:15', 1400), gf('12:30', 1600), gf('12:45', 1500)];
  assert.equal(detectArrivalGap(flights, 720), null);
});

test('detectArrivalGap: 末尾の空白(以降に便なし=本日の到着終了)は谷間にしない', () => {
  const flights = [gf('12:00', 1500)]; // これ以降便なし
  assert.equal(detectArrivalGap(flights, 720), null);
});

test('detectArrivalGap: 欠航便は無視する', () => {
  const flights = [gf('12:00', 1500), { lobbyExitTime: '12:30', estimatedPax: 1500, status: '欠航' }, gf('13:00', 1500)];
  const r = detectArrivalGap(flights, 720);
  assert.equal(r.kind, 'gap'); // 12:15〜13:00 が空く
  assert.equal(r.startMin, 735);
});

test('filterByLane: 0/未指定は全便、1-4はpoolLane一致のみ', () => {
  const flights = [
    { flightNumber: 'JL1', poolLane: 1 },
    { flightNumber: 'NH2', poolLane: 3 },
    { flightNumber: 'JL3', poolLane: 1 },
    { flightNumber: 'XX4' }, // poolLane 未確定
  ];
  assert.equal(filterByLane(flights, 0).length, 4);
  assert.equal(filterByLane(flights, 1).length, 2);
  assert.deepEqual(filterByLane(flights, 3).map(f => f.flightNumber), ['NH2']);
  assert.equal(filterByLane(flights, 4).length, 0);
  assert.deepEqual(filterByLane(null, 1), []);
});

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

test('detectTopics: poolLane(号)を topic に持たせる(未確定は null)', () => {
  const flights = [
    { flightNumber: 'JL9', scheduledTime: '10:00', estimatedTime: '10:45', terminal: 'T2', poolLane: 4 },
    { flightNumber: 'JL8', scheduledTime: '11:00', estimatedTime: '11:50' }, // poolLane 未確定
  ];
  const topics = detectTopics(flights);
  assert.equal(topics.find(t => t.flightNumber === 'JL9').poolLane, 4);
  assert.equal(topics.find(t => t.flightNumber === 'JL8').poolLane, null);
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

// --- listOriginOptions: 出発地フィルタ用の選択肢 ---

test('listOriginOptions: 便数降順で出発地と便数を返す', () => {
  const flights = [
    { fromName: '千歳' }, { fromName: '千歳' }, { fromName: '千歳' },
    { fromName: '福岡' }, { fromName: '福岡' },
    { fromName: '伊丹' },
  ];
  assert.deepEqual(listOriginOptions(flights), [
    { fromName: '千歳', count: 3 },
    { fromName: '福岡', count: 2 },
    { fromName: '伊丹', count: 1 },
  ]);
});

test('listOriginOptions: 同点は fromName 昇順', () => {
  const flights = [
    { fromName: '福岡' }, { fromName: '福岡' },
    { fromName: '伊丹' }, { fromName: '伊丹' },
    { fromName: '千歳' }, { fromName: '千歳' },
  ];
  assert.deepEqual(listOriginOptions(flights), [
    { fromName: '伊丹', count: 2 },
    { fromName: '千歳', count: 2 },
    { fromName: '福岡', count: 2 },
  ]);
});

test('listOriginOptions: fromName 無し便は除外', () => {
  const flights = [
    { fromName: '札幌' },
    { fromName: null },
    {},
  ];
  assert.deepEqual(listOriginOptions(flights), [{ fromName: '札幌', count: 1 }]);
});

test('listOriginOptions: 空配列は空配列', () => {
  assert.deepEqual(listOriginOptions([]), []);
  assert.deepEqual(listOriginOptions(null), []);
});


import { aggregateHeatmapClient, summarizeFlights } from '../tools/js/arrivals-data.js';

test('aggregateHeatmapClient: 欠航便は降客数に含めず cancelledCount で別計上', () => {
  const flights = [
    { estimatedTime: '13:10', estimatedPax: 100, isInternational: false, status: '到着' },
    { estimatedTime: '13:20', estimatedPax: 80, isInternational: true, status: '欠航' },
  ];
  const bins = aggregateHeatmapClient(flights);
  const b = bins.find(x => x.bin === '13:00');
  assert.equal(b.totalPax, 100);        // 欠航の80は含めない
  assert.equal(b.cancelledCount, 1);    // 欠航を別計上
  assert.equal(b.flightCount, 1);       // 運航便のみ
});

test('summarizeFlights: 欠航便を pax から除外し cancelledCount を返す', () => {
  const flights = [
    { estimatedPax: 100, isInternational: false, status: '到着' },
    { estimatedPax: 80, isInternational: true, status: '欠航' },
    { estimatedPax: 60, isInternational: false, status: '欠航' },
  ];
  const s = summarizeFlights(flights);
  assert.equal(s.totalPax, 100);     // 欠航2便分を除外
  assert.equal(s.cancelledCount, 2);
  assert.equal(s.totalFlights, 1);   // 運航便のみ
});

test('formatLaneDisplay: 確定なしは推定号(無しは空)', () => {
  assert.equal(formatLaneDisplay(4, null), '4');
  assert.equal(formatLaneDisplay(null, null), '');
});

test('formatLaneDisplay: 確定=推定は確定号のみ', () => {
  assert.equal(formatLaneDisplay(3, 3), '3');
});

test('formatLaneDisplay: 確定≠推定は 4→3', () => {
  assert.equal(formatLaneDisplay(4, 3), '4→3');
});

// --- detectTopics: 日またぎ + 現実性フィルタ (2026-08-09 追加) ---
// 背景: (1) 定刻23:50→予定0:40 の日またぎ便が -1390分→0分扱いになり枠から漏れる
// (2) 羽田APIが国際便のstatusを更新せず、着いたはずの便が何時間も「到着予定」で居座り
//     下の便リスト(時間窓あり)とズレる (NH113 15:25→19:50 が21:30にも表示された実例)

test('detectTopics: 日またぎ遅延(23:50→0:40)を50分遅延として拾う', () => {
  const flights = [
    { flightNumber: 'NH99', scheduledTime: '23:50', estimatedTime: '00:40' },
  ];
  const topics = detectTopics(flights);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].delayMin, 50);
});

test('detectTopics: 到着予定が30分より過去の便は出さない(now指定時)', () => {
  const now = 21 * 60 + 30; // 21:30
  const flights = [
    { flightNumber: 'STALE', scheduledTime: '15:25', estimatedTime: '19:50' }, // 100分過去
    { flightNumber: 'RECENT', scheduledTime: '20:30', estimatedTime: '21:15' }, // 15分過去=猶予内
    { flightNumber: 'FUTURE', scheduledTime: '21:20', estimatedTime: '22:20' },
  ];
  const topics = detectTopics(flights, now);
  assert.deepEqual(topics.map(t => t.flightNumber), ['RECENT', 'FUTURE']);
});

test('detectTopics: now未指定なら従来どおり過去便も残る(後方互換)', () => {
  const flights = [
    { flightNumber: 'STALE', scheduledTime: '15:25', estimatedTime: '19:50' },
  ];
  assert.equal(detectTopics(flights).length, 1);
});

test('detectTopics: 深夜は日またぎ順に並ぶ(23:45 → 0:15)', () => {
  const now = 23 * 60 + 30; // 23:30
  const flights = [
    { flightNumber: 'AFTER_MID', scheduledTime: '23:30', estimatedTime: '00:15' },
    { flightNumber: 'BEFORE_MID', scheduledTime: '23:10', estimatedTime: '23:45' },
  ];
  const topics = detectTopics(flights, now);
  assert.deepEqual(topics.map(t => t.flightNumber), ['BEFORE_MID', 'AFTER_MID']);
});

test('detectTopics: 日またぎ便は深夜0時台のnowでも未来扱いで残る', () => {
  const now = 0 * 60 + 10; // 0:10
  const flights = [
    { flightNumber: 'NH99', scheduledTime: '23:50', estimatedTime: '00:40' },
  ];
  const topics = detectTopics(flights, now);
  assert.equal(topics.length, 1);
});

test('detectTopics: 欠航便は出さない', () => {
  const flights = [
    { flightNumber: 'CXL', scheduledTime: '10:00', estimatedTime: '11:00', status: '欠航' },
  ];
  assert.equal(detectTopics(flights).length, 0);
});

// --- 現地掲示(lateFlights)の上書き (2026-08-09 B実装) ---
// 深夜遅延便は静的推定より現地掲示が正(実測35便でMAE97人・号も掲示が確定)。

test('noticeNameToFlightNumber: 掲示の便名をIATA便名に変換', () => {
  assert.equal(noticeNameToFlightNumber('ANA84 札幌便'), 'NH84');
  assert.equal(noticeNameToFlightNumber('JAL920 沖縄便'), 'JL920');
  assert.equal(noticeNameToFlightNumber('ソラシド26 沖縄便'), '6J26');
  assert.equal(noticeNameToFlightNumber('エアドゥ38便'), 'HD38');
  assert.equal(noticeNameToFlightNumber('SKY522　沖縄便'), 'BC522');
  assert.equal(noticeNameToFlightNumber('全日空 深圳便'), null, '便番号なしはnull');
  assert.equal(noticeNameToFlightNumber(null), null);
});

test('applyNoticeOverrides: 人数と号を上書きし元値を退避する', () => {
  const flights = [
    { flightNumber: 'NH084', status: '不明', estimatedPax: 304, poolLane: 3 },
    { flightNumber: 'JL916', status: '不明', estimatedPax: 303, poolLane: 2 },
  ];
  const late = { flights: [
    { name: 'ANA84 札幌便', pax: 71, stall: 4, arrived: false, eta: { text: '0:48' } },
  ] };
  const n = applyNoticeOverrides(flights, late);
  assert.equal(n, 1);
  const f = flights[0];
  assert.equal(f.estimatedPax, 71);
  assert.equal(f.estimatedPaxModel, 304);
  assert.equal(f.paxSource, 'notice');
  assert.equal(f.poolLane, 4);
  assert.equal(f.poolLaneModel, 3);
  assert.equal(f.noticeEta, '0:48');
  assert.equal(flights[1].estimatedPax, 303, '非対象便は不変');
});

test('applyNoticeOverrides: 到着済み掲示・欠航便・掲示なしは無視', () => {
  const flights = [
    { flightNumber: 'NH84', status: '欠航', estimatedPax: 300 },
    { flightNumber: 'JL920', status: '不明', estimatedPax: 300 },
  ];
  const late = { flights: [
    { name: 'ANA84 札幌便', pax: 71, stall: 4, arrived: false },
    { name: 'JAL920 沖縄便', pax: 356, stall: 1, arrived: true },
  ] };
  assert.equal(applyNoticeOverrides(flights, late), 0);
  assert.equal(applyNoticeOverrides(flights, null), 0);
  assert.equal(flights[1].estimatedPax, 300);
});

test('buildLaneNoticeMap: byStallとqueueを号別にまとめる', () => {
  const late = { summary: {
    byStall: { 3: { pendingPax: 500, pendingFlights: 2, nextEta: '0:40' } },
    queue: { 3: 50, 2: 70 },
  } };
  const m = buildLaneNoticeMap(late);
  assert.deepEqual(m[3], { pendingPax: 500, pendingFlights: 2, nextEta: '0:40', queue: 50 });
  assert.deepEqual(m[2], { pendingPax: 0, pendingFlights: 0, nextEta: null, queue: 70 });
  assert.equal(m[1], undefined);
  assert.deepEqual(buildLaneNoticeMap(null), {});
});

test('detectTopics: 上書きされたpaxSourceがtopicに乗る', () => {
  const flights = [
    { flightNumber: 'NH84', scheduledTime: '23:05', estimatedTime: '00:48', estimatedPax: 71, paxSource: 'notice' },
  ];
  const topics = detectTopics(flights);
  assert.equal(topics[0].paxSource, 'notice');
  assert.equal(topics[0].delayMin, 103);
});

// --- 待機車両の「いつも」比較 (2026-08-09 表示基準の修正) ---
// 同じ4段でも 2号(普段0.87)は少なめ・4号(普段0.50)は多め、と意味が真逆になる問題。

test('compareToTypical: 普段との差(ポイント)で3段階に言い換える', () => {
  assert.equal(compareToTypical(0.80, 0.50), 'いつもより多い');   // 4号の0.80
  assert.equal(compareToTypical(0.80, 0.87), 'いつもどおり');     // 2号の0.80
  assert.equal(compareToTypical(0.60, 0.87), 'いつもより少ない'); // 2号が空いている
  assert.equal(compareToTypical(0.65, 0.57), 'いつもどおり');     // 差8pt=誤差内
  assert.equal(compareToTypical(0.5, null), null);
  assert.equal(compareToTypical(0.5, 0), null, '普段0は基準にしない');
});

test('buildNoribaActivity: typicalFillRate があれば目盛りと相対ラベルが付く', () => {
  const arrivals = { flights: [] };
  const poolStatus = { stalls: {
    stall1: { fillRate: 0.80, typicalFillRate: 0.57, occ: 12 },
    stall2: { fillRate: 0.80, typicalFillRate: 0.87, occ: 12 },
    stall3: { fillRate: 0.50, occ: 8 },
  } };
  const acts = buildNoribaActivity(arrivals, null, poolStatus, new Date('2026-08-09T13:00:00+09:00'));
  const l1 = acts.find(a => a.lane === 1), l2 = acts.find(a => a.lane === 2), l3 = acts.find(a => a.lane === 3);
  assert.equal(l1.occupancy.typicalPct, 57);
  assert.equal(l1.occupancy.vsTypical, 'いつもより多い', '4段でも1号は普段より多い');
  assert.equal(l2.occupancy.typicalPct, 87);
  assert.equal(l2.occupancy.vsTypical, 'いつもどおり', '同じ4段でも2号は普段どおり');
  assert.equal(l3.occupancy.typicalPct, undefined, '基準が無い号は目盛りを出さない');
  assert.equal(l3.occupancy.label, '並程度', '従来の量ラベルは残る');
});

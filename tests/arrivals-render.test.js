import { test, assert } from './run.js';
import { weatherCodeToLabel, renderDelayLaneGuide } from '../tools/js/arrivals-render.js';

test('weatherCodeToLabel: 雨 (61-67) は advisory あり', () => {
  const r = weatherCodeToLabel(61);
  assert.equal(r.label, '雨');
  assert.equal(r.icon, '☔');
  assert.ok(r.advisory, 'advisory should be set');
});

test('weatherCodeToLabel: 雷雨 (95+) は advisory あり', () => {
  const r = weatherCodeToLabel(95);
  assert.equal(r.label, '雷雨');
  assert.ok(r.advisory);
});

test('weatherCodeToLabel: にわか雨 (80-82)', () => {
  assert.equal(weatherCodeToLabel(80).label, 'にわか雨');
  assert.equal(weatherCodeToLabel(82).label, 'にわか雨');
});

test('weatherCodeToLabel: 雪 (71-77)', () => {
  assert.equal(weatherCodeToLabel(73).label, '雪');
});

test('weatherCodeToLabel: 霧 (45/48)', () => {
  assert.equal(weatherCodeToLabel(45).label, '霧');
  assert.equal(weatherCodeToLabel(48).label, '霧');
});

test('weatherCodeToLabel: 曇り (低 code) は advisory なし', () => {
  const r = weatherCodeToLabel(2);
  assert.equal(r.advisory, null);
});

test('weatherCodeToLabel: null/非数値は null', () => {
  assert.equal(weatherCodeToLabel(null), null);
  assert.equal(weatherCodeToLabel(undefined), null);
  assert.equal(weatherCodeToLabel('61'), null);
});

// --- 遅延便の「並ぶ乗り場」ガイドの描画 (2026-08-15) ------------------------
// container は innerHTML/hidden しか触らないので、素のオブジェクトで検証できる。
const stub = () => ({ innerHTML: '', hidden: false });

test('renderDelayLaneGuide: 便が無ければ隠す', () => {
  const c = stub();
  renderDelayLaneGuide(c, { lanes: [], unresolved: [], total: 0 });
  assert.equal(c.hidden, true);
  assert.equal(c.innerHTML, '');
});

test('renderDelayLaneGuide: 号を見出しに、通常時・遅れた日・今夜の確定を並べる', () => {
  const c = stub();
  renderDelayLaneGuide(c, {
    total: 1,
    unresolved: [],
    lanes: [{
      lane: 4, terminal: 'T2', count: 1, pax: 164, strongest: 'notice',
      occupancy: { segments: 5, label: '多め', vsTypical: 'いつもより多い' },
      flights: [{
        flightNumber: 'NH84', fromName: '札幌', scheduledTime: '23:05', estimatedTime: '0:48',
        delayMin: 103, estimatedPax: 164, lane: 4, basis: 'notice', basisN: null,
        normalLane: 3, trend: { lane: 4, n: 2, share: 1 }, confirmedLane: 4,
      }],
    }],
  });
  assert.equal(c.hidden, false);
  assert.match(c.innerHTML, /dg-no lane-4">4号/);
  assert.match(c.innerHTML, /b-notice">現地掲示/);
  assert.match(c.innerHTML, /通常<\/span>3号/);
  assert.match(c.innerHTML, /遅れた日<\/span><span class="v is-diff">4号<\/span><span class="n">\(過去2回とも\)/);
  assert.match(c.innerHTML, /今夜<\/span><span class="v is-diff">4号に確定/);
  assert.match(c.innerHTML, /103分遅れ/);
  assert.match(c.innerHTML, /待機 いつもより多い/);
});

test('renderDelayLaneGuide: 実績は回数を添え、推定は推定と明示する', () => {
  const c = stub();
  const fl = (o) => ({ flightNumber: 'X1', fromName: '福岡', scheduledTime: '22:00', estimatedTime: '23:30', delayMin: 90, estimatedPax: 90, lane: 3, normalLane: 3, trend: null, confirmedLane: null, ...o });
  renderDelayLaneGuide(c, {
    total: 2, unresolved: [],
    lanes: [{ lane: 3, terminal: 'T2', count: 2, pax: 180, strongest: 'actual', occupancy: {},
      flights: [fl({ basis: 'actual', basisN: 2, trend: { lane: 3, n: 2, share: 1 } }), fl({ basis: 'estimate', basisN: null })] }],
  });
  assert.match(c.innerHTML, /title="過去2回とも3号"/);
  assert.match(c.innerHTML, /遅れた日<\/span><span class="n">実績なし/, '傾向が無いことも明示する');
  assert.match(c.innerHTML, /b-actual"[^>]*>実績/);
  assert.match(c.innerHTML, /b-estimate">推定/);
});

test('renderDelayLaneGuide: 号が分からない便も落とさず出す', () => {
  const c = stub();
  renderDelayLaneGuide(c, {
    total: 1, lanes: [],
    unresolved: [{ flightNumber: 'JL999', estimatedTime: '1:20', terminal: 'T1' }],
  });
  assert.match(c.innerHTML, /乗り場が分からない便: 1:20 JL999\(T1\)/);
});

test('renderDelayLaneGuide: 人数不明の便でも「約null人」にしない', () => {
  const c = stub();
  renderDelayLaneGuide(c, {
    total: 1, unresolved: [],
    lanes: [{ lane: 1, terminal: 'T1', count: 1, pax: 0, strongest: 'estimate', occupancy: {},
      flights: [{ flightNumber: 'JL1', fromName: '伊丹', scheduledTime: '22:00', estimatedTime: '23:00', delayMin: 60, estimatedPax: null, lane: 1, basis: 'estimate', basisN: null, normalLane: null }] }],
  });
  assert.match(c.innerHTML, /人数不明/);
  assert.doesNotMatch(c.innerHTML, /null/);
});

test('renderDelayLaneGuide: 先の遅延便しか無くても件数は伝える(黙って落とさない)', () => {
  const c = stub();
  renderDelayLaneGuide(c, { lanes: [], unresolved: [], total: 0, laterCount: 2 });
  assert.equal(c.hidden, false);
  assert.match(c.innerHTML, /3時間より先の遅延便: あと2便/);
});

// --- 過去日の「この日のまとめ」 ---
import { renderDaySummary, renderCarriedOver } from '../tools/js/arrivals-render.js';

test('renderDaySummary: 配車業務の終了時刻を出す', () => {
  const c = stub();
  renderDaySummary(c, { totalFlights: 538, delayed15: 1, delayed30: 1, maxDelay: 113,
    maxDelayFlight: { flightNumber: 'NH4738', fromName: '千歳', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3, delayMin: 113 },
    overnightFlights: [], dispatchEndedAt: '01:30' });
  assert.equal(c.hidden, false);
  assert.ok(c.innerHTML.includes('01:30'), '終了時刻');
  assert.ok(c.innerHTML.includes('本日の配車業務は終了しました'), '何の時刻かを添える');
});

test('renderDaySummary: 24時超えの到着は 00:33 と読みやすく出す', () => {
  const c = stub();
  renderDaySummary(c, { totalFlights: 1, delayed15: 1, delayed30: 1, maxDelay: 113,
    maxDelayFlight: { flightNumber: 'NH4738', fromName: '千歳', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3, delayMin: 113 },
    overnightFlights: [], dispatchEndedAt: null });
  assert.ok(c.innerHTML.includes('00:33'), '24:33 ではなく 00:33');
  assert.ok(c.innerHTML.includes('113分遅れ'));
  assert.ok(c.innerHTML.includes('3号'));
});

test('renderDaySummary: 遅れが無かった日はそう書く', () => {
  const c = stub();
  renderDaySummary(c, { totalFlights: 541, delayed15: 0, delayed30: 0, maxDelay: 0,
    maxDelayFlight: null, overnightFlights: [], dispatchEndedAt: '00:50' });
  assert.ok(c.innerHTML.includes('なし'));
  assert.ok(c.innerHTML.includes('00:50'));
});

test('renderDaySummary: まとめが無ければ隠す', () => {
  const c = stub();
  renderDaySummary(c, null);
  assert.equal(c.hidden, true);
  assert.equal(c.innerHTML, '');
});

// --- 深夜の持ち越し便 ---

test('renderCarriedOver: 持ち越し便を到着時刻・遅れ・号つきで出す', () => {
  const c = stub();
  renderCarriedOver(c, { isOvernight: true, morning: [{}, {}],
    carriedOver: [{ flightNumber: 'NH4738', fromName: '千歳', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3, delayMin: 113, estimatedTaxiPax: 81 }] },
    new Date('2026-09-09T00:40:00+09:00'));
  assert.equal(c.hidden, false);
  assert.ok(c.innerHTML.includes('00:33'), '24:33 ではなく 00:33');
  assert.ok(c.innerHTML.includes('113分遅れ'));
  assert.ok(c.innerHTML.includes('3号'));
  assert.ok(!c.innerHTML.includes('81人'), 'タクシー人数は推定なので出さない');
  assert.ok(c.innerHTML.includes('7分前に到着'), '0:40 から見て 0:33 は7分前');
  assert.ok(c.innerHTML.includes('朝の便'), '畳んだ朝の便の件数を添える');
});

test('renderCarriedOver: まだ着いていない便は「あと何分」', () => {
  const c = stub();
  renderCarriedOver(c, { isOvernight: true, morning: [],
    carriedOver: [{ flightNumber: 'X', fromName: '札幌', scheduledTime: '23:00', estimatedTime: '24:33', poolLane: 1, delayMin: 93 }] },
    new Date('2026-09-09T00:10:00+09:00'));
  assert.ok(c.innerHTML.includes('あと23分'), '0:10 から見て 0:33 は23分後');
});

test('renderCarriedOver: 深夜でなければ隠す', () => {
  const c = stub();
  renderCarriedOver(c, { isOvernight: false, carriedOver: [], morning: [] }, new Date('2026-09-08T14:00:00+09:00'));
  assert.equal(c.hidden, true);
});

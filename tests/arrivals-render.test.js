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

import { test, assert } from './run.js';
import { levelText, levelDots, activityText, isStale, waitText, trendText, formatStallLine, formatTerminalArrivals, formatActivityLine, formatStallLineV2, formatArrivalsList, getCollapsed, setCollapsed } from '../tools/js/pool-status-section.js';

test('pool-status-section pure helpers', async () => {
  assert.equal(levelText('empty'), '空き');
  assert.equal(levelText('full'), '満車');
  assert.equal(levelDots('crowded'), '●●●○');
  assert.equal(activityText({ level: 'active', arrow: 'up' }), '活発↑');
  assert.equal(activityText({ level: 'low', arrow: 'down' }), '少なめ↓');
  assert.equal(activityText(null), '—');
  const now = Date.parse('2026-05-25T12:00:00+09:00');
  assert.equal(isStale('2026-05-25T11:00:00+09:00', now, 30), true);
  assert.equal(isStale('2026-05-25T11:50:00+09:00', now, 30), false);
  assert.equal(isStale('bad-date', now, 30), true);
});

test('pool-status-section: 乗り場フォーマッタ', async () => {
  assert.equal(waitText(20), '約20分');
  assert.equal(waitText(null), '—');
  assert.equal(trendText('up'), '活発↑');
  assert.equal(trendText('flat'), '横ばい→');
  assert.equal(trendText('down'), '少なめ↓');
  assert.equal(trendText('xxx'), '—');
  assert.equal(
    formatStallLine({ label: '第1乗り場', occ: 9, waitMin: 135, trend: 'up' }),
    '第1乗り場：在台 約9台 ／ 待ち目安 約135分 ／ 出 活発↑'
  );
  assert.equal(
    formatStallLine({ label: '第2乗り場', occ: 0, waitMin: null, trend: 'flat' }),
    '第2乗り場：在台 約0台 ／ 待ち目安 — ／ 出 横ばい→'
  );
});

test('pool-status-section: ターミナル到着便フォーマッタ', async () => {
  const ta = { T1: { next30: 5, next60: 8 }, T2: { next30: 0, next60: 7 } };
  assert.deepEqual(formatTerminalArrivals(ta), [
    '第1・2乗り場（JAL T1）これから来る客：30分で約5人 ／ 60分で約8人',
    '第3・4乗り場（ANA T2）これから来る客：30分で約0人 ／ 60分で約7人',
  ]);
  assert.deepEqual(formatTerminalArrivals(null), []);
});

test('formatActivityLine: 同条件比較あり', async () => {
  const activity = {
    recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat',
    sameConditionCompare: { peers_typical: 47, percent: 26, label: 'いつもより活発', dayLabel: '火曜平日' },
  };
  assert.equal(formatActivityLine(activity), 'いつもより活発→ （火曜平日 同時間帯比 +26%）');
});

test('formatActivityLine: 同条件比較サンプル不足は活発度のみ', async () => {
  const activity = {
    recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat',
    sameConditionCompare: { peers_typical: null, percent: null, label: null, dayLabel: '火曜平日' },
  };
  assert.equal(formatActivityLine(activity), '平常→');
});

test('formatActivityLine: sameConditionCompare 未提供（旧データ）は活発度のみ', async () => {
  const activity = { recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat' };
  assert.equal(formatActivityLine(activity), '平常→');
});

test('formatActivityLine: percentがマイナスは符号付き', async () => {
  const activity = {
    sameConditionCompare: { peers_typical: 50, percent: -20, label: 'いつもより少なめ', dayLabel: '日曜・週末' },
    level: 'low', arrow: 'down',
  };
  assert.equal(formatActivityLine(activity), 'いつもより少なめ↓ （日曜・週末 同時間帯比 -20%）');
});

test('formatStallLineV2: 順位なし＝ふつう、普段比は別語彙でカッコ', async () => {
  assert.equal(
    formatStallLineV2({ label: '第1乗り場', trend: 'down', rankHint: null }),
    '第1乗り場  ふつう（普段より静か）'
  );
});

test('formatStallLineV2: most-active＝🚕いちばん出てる', async () => {
  assert.equal(
    formatStallLineV2({ label: '第3乗り場', trend: 'up', rankHint: 'most-active' }),
    '第3乗り場  🚕 いちばん出てる（普段より多め）'
  );
});

test('formatStallLineV2: most-low＝🅿出は少なめ（flatはカッコなし）', async () => {
  assert.equal(
    formatStallLineV2({ label: '第4乗り場', trend: 'flat', rankHint: 'most-low' }),
    '第4乗り場  🅿 出は少なめ'
  );
});

test('formatStallLineV2: trend 未定義は —', async () => {
  assert.equal(
    formatStallLineV2({ label: '第2乗り場' }),
    '第2乗り場  —'
  );
});

test('formatArrivalsList: T1/T2 順、便ごと1行', async () => {
  const list = {
    T1: [
      { flightNumber: 'JL024', airline: 'JAL', fromName: '関西', seatCount: 244, lobbyExitMinutes: 10 },
      { flightNumber: 'JL026', airline: 'JAL', fromName: '福岡', seatCount: 322, lobbyExitMinutes: 28 },
    ],
    T2: [
      { flightNumber: 'NH032', airline: 'ANA', fromName: '新千歳', seatCount: 195, lobbyExitMinutes: 8 },
    ],
  };
  const lines = formatArrivalsList(list);
  assert.deepEqual(lines, [
    'T1ターミナル',
    '  あと10分  関西から  244人乗り',
    '  あと28分  福岡から  322人乗り',
    'T2ターミナル',
    '  あと8分  新千歳から  195人乗り',
  ]);
});

test('formatArrivalsList: 片側空ならその見出しは出さない', async () => {
  const list = { T1: [], T2: [{ flightNumber: 'NH032', airline: 'ANA', fromName: '新千歳', seatCount: 195, lobbyExitMinutes: 8 }] };
  const lines = formatArrivalsList(list);
  assert.deepEqual(lines, ['T2ターミナル', '  あと8分  新千歳から  195人乗り']);
});

test('formatArrivalsList: null/未提供は空配列', async () => {
  assert.deepEqual(formatArrivalsList(null), []);
  assert.deepEqual(formatArrivalsList({ T1: [], T2: [] }), []);
});

test('formatArrivalsList: noribaList があれば号別表示・席数nullは席数不明', async () => {
  const noriba = {
    1: [{ flightNumber: 'JL138', fromName: '伊丹', seatCount: 200, lobbyExitMinutes: 3 }],
    2: [{ flightNumber: 'JL918', fromName: '那覇', seatCount: 369, lobbyExitMinutes: 3 }],
    3: [{ flightNumber: 'NH472', fromName: '那覇', seatCount: null, lobbyExitMinutes: 3 }],
    4: [],
  };
  const lines = formatArrivalsList(noriba, { T1: [], T2: [] });
  assert.deepEqual(lines, [
    '1号（T1 南）',
    '  あと3分  伊丹から  200人乗り',
    '2号（T1 北）',
    '  あと3分  那覇から  369人乗り',
    '3号（T2 北）',
    '  あと3分  那覇から  席数不明',
  ]);
});

test('formatArrivalsList: noribaList 空なら terminalList にフォールバック', async () => {
  const lines = formatArrivalsList({ 1: [], 2: [], 3: [], 4: [] }, { T1: [{ flightNumber: 'JL024', fromName: '関西', seatCount: 244, lobbyExitMinutes: 10 }], T2: [] });
  assert.deepEqual(lines, ['T1ターミナル', '  あと10分  関西から  244人乗り']);
});

test('formatStallLineV2: most-active + percent あり', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第3乗り場', trend: 'up', rankHint: 'most-active',
      sameConditionCompare: { peers_typical: 20, percent: 5, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第3乗り場  🚕 いちばん出てる（いつもの +5%）'
  );
});

test('formatStallLineV2: most-low + percent マイナス', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第1乗り場', trend: 'down', rankHint: 'most-low',
      sameConditionCompare: { peers_typical: 22, percent: -23, label: 'いつもより少なめ', dayLabel: '火曜平日' }
    }),
    '第1乗り場  🅿 出は少なめ（いつもの -23%）'
  );
});

test('formatStallLineV2: 順位なし + percent あり', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第2乗り場', trend: 'flat', rankHint: null,
      sameConditionCompare: { peers_typical: 10, percent: -2, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第2乗り場  ふつう（いつもの -2%）'
  );
});

test('formatStallLineV2: most-active + percent null は普段比を trend で補う', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第3乗り場', trend: 'up', rankHint: 'most-active',
      sameConditionCompare: { peers_typical: null, percent: null, label: null, dayLabel: '火曜平日' }
    }),
    '第3乗り場  🚕 いちばん出てる（普段より多め）'
  );
});

test('formatStallLineV2: most-low + percent null（flatはカッコなし）', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第4乗り場', trend: 'flat', rankHint: 'most-low',
      sameConditionCompare: null
    }),
    '第4乗り場  🅿 出は少なめ'
  );
});

test('formatStallLineV2: 順位なし + flat + sc未提供＝ふつうのみ', async () => {
  assert.equal(
    formatStallLineV2({ label: '第2乗り場', trend: 'flat', rankHint: null }),
    '第2乗り場  ふつう'
  );
});

test('formatStallLineV2: percent=0 は "+0%"', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第2乗り場', trend: 'flat', rankHint: null,
      sameConditionCompare: { peers_typical: 10, percent: 0, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第2乗り場  ふつう（いつもの +0%）'
  );
});

test('getCollapsed: localStorageに値なしならfalse', async () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('getCollapsed: "1" なら true', async () => {
  const store = new Map([['forecast-section-collapsed', '1']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), true);
});

test('getCollapsed: "0" は false', async () => {
  const store = new Map([['forecast-section-collapsed', '0']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('setCollapsed: true → "1" / false → "0" を保存', async () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  setCollapsed(true, storage);
  assert.equal(store.get('forecast-section-collapsed'), '1');
  setCollapsed(false, storage);
  assert.equal(store.get('forecast-section-collapsed'), '0');
});

test('setCollapsed/getCollapsed: ストレージ例外時はfalseに fallback', async () => {
  const storage = {
    getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('disabled'); },
  };
  // クラッシュしないことを確認
  setCollapsed(true, storage);
  assert.equal(getCollapsed(storage), false);
});

import { test } from 'node:test';
import assert from 'node:assert';
import { hourlyDowEfficiency } from '../js/chart-helpers.js';

test('hourlyDowEfficiency: 休憩中の時間は実稼働時間 (workingMin) から除外される', () => {
  // 木曜 (2026-04-23 は木曜)
  // 出庫 18:00、帰庫 20:00、休憩 18:00-19:30 → 18時セルは休憩で全埋め(workingMin=0)、19時セルは19:30まで休憩で30分稼働
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [],
    rests: [{ startTime: '18:00', endTime: '19:30', place: 'X' }]
  }];
  const m = hourlyDowEfficiency(drives);
  const dow = 4; // 木曜
  assert.equal(m[dow][18].workingMin, 0, '18時セルは休憩で全埋め');
  assert.equal(m[dow][19].workingMin, 30, '19時セルは19:30まで休憩、30分間稼働');
});

test('hourlyDowEfficiency: hourlyA は workingMin ベース(売上÷実稼働時間)', () => {
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:30', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount: 3000, isPickup: true, isCancel: false, waitTime: '' }],
    rests: [{ startTime: '18:00', endTime: '19:30', place: 'X' }]
  }];
  const m = hourlyDowEfficiency(drives);
  const dow = 4;
  // 19時セル: workingMin=30, sales=3000, hourlyA = 3000 / (30/60) = 6000
  assert.equal(m[dow][19].sales, 3000);
  assert.equal(m[dow][19].workingMin, 30);
  assert.equal(m[dow][19].hourlyA, 6000);
});

test('hourlyDowEfficiency: hourlyB は削除されている', () => {
  const drives = [{
    date: '2026-04-23',
    departureTime: '18:00',
    returnTime: '20:00',
    trips: [],
    rests: []
  }];
  const m = hourlyDowEfficiency(drives);
  assert.equal(m[4][18].hourlyB, undefined, 'hourlyB プロパティは削除済み');
});

import {
  coefficientOfVariation, stabilityTier, classifyEarning
} from '../js/chart-helpers.js';

test('coefficientOfVariation: 標準偏差/平均。全て同値ならCV=0', () => {
  assert.equal(coefficientOfVariation([100, 100, 100]), 0);
});

test('coefficientOfVariation: 空配列や平均0は0を返す', () => {
  assert.equal(coefficientOfVariation([]), 0);
  assert.equal(coefficientOfVariation([0, 0]), 0);
});

test('coefficientOfVariation: 既知値（母集団標準偏差）', () => {
  // values [2,4,4,4,5,5,7,9]: mean=5, 母分散=4, std=2, CV=0.4
  assert.equal(coefficientOfVariation([2,4,4,4,5,5,7,9]), 0.4);
});

test('stabilityTier: 3件未満は insufficient', () => {
  assert.equal(stabilityTier([100, 100]), 'insufficient');
  assert.equal(stabilityTier([]), 'insufficient');
});

test('stabilityTier: CV<=0.3=stable, <=0.6=mid, >0.6=volatile', () => {
  assert.equal(stabilityTier([100, 100, 100]), 'stable');        // CV=0
  assert.equal(stabilityTier([2,4,4,4,5,5,7,9]), 'mid');          // CV=0.4
  assert.equal(stabilityTier([10, 50, 100]), 'volatile');        // CV>0.6
});

test('classifyEarning: 有効値分布の上位1/3=earn, 下位1/3=rest, 中間=normal', () => {
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90]; // 9件
  assert.equal(classifyEarning(90, vals), 'earn');   // 最上位
  assert.equal(classifyEarning(80, vals), 'earn');   // pct=7/9>=2/3
  assert.equal(classifyEarning(50, vals), 'normal'); // pct=4/9
  assert.equal(classifyEarning(10, vals), 'rest');   // pct=0
  assert.equal(classifyEarning(20, vals), 'rest');   // pct=1/9<1/3
});

test('classifyEarning: 値0や有効値3件未満は none', () => {
  assert.equal(classifyEarning(0, [10, 20, 30]), 'none');
  assert.equal(classifyEarning(50, [50, 60]), 'none');
});

import { hourlyDowDailyValues, zoneDailyValues } from '../js/chart-helpers.js';
import { getShiftZones, ZONE_PRESETS } from '../js/chart-helpers.js';

test('getShiftZones: 出庫時刻からの5時間区切り順を保つ', () => {
  const labels = getShiftZones('09:05').map(z => z.label);
  assert.deepEqual(labels, ['9-14時', '14-19時', '19-0時(翌)', '0-5時']);
});

test('hourlyDowDailyValues: 同じ曜日の別日が、その時間帯セルに日別¥/hとして積まれる', () => {
  // 2026-04-23(木) と 2026-04-30(木) の 19時台。各日 workingMin=60, 売上 6000/3000
  const mk = (date, amount) => ({
    date, departureTime: '19:00', returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:30', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mk('2026-04-23', 6000), mk('2026-04-30', 3000)];
  const daily = hourlyDowDailyValues(drives);
  const dow = 4; // 木
  assert.equal(daily[dow][19].length, 2, '木19時に2日分');
  assert.deepEqual([...daily[dow][19]].sort((a,b)=>a-b), [3000, 6000]);
});

test('hourlyDowDailyValues: 実稼働0の時間帯は積まれない', () => {
  const drives = [{
    date: '2026-04-23', departureTime: '18:00', returnTime: '19:00',
    trips: [], rests: [{ startTime: '18:00', endTime: '19:00', place: 'X' }] // 全休憩
  }];
  const daily = hourlyDowDailyValues(drives);
  assert.equal(daily[4][18].length, 0, '休憩で実稼働0なら積まれない');
});

test('zoneDailyValues: ゾーン単位で日別¥/hが積まれる', () => {
  const zones = ZONE_PRESETS['human'].zones;
  const mk = (date) => ({
    date, departureTime: '19:00', returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:30', boardPlace: 'A', alightPlace: 'B', km: 5, amount: 4000, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mk('2026-04-23'), mk('2026-04-30')];
  const daily = zoneDailyValues(drives, zones);
  // 19時が属するゾーンキーを特定して2日分あることを確認
  const dow = 4;
  const total = Object.values(daily[dow]).reduce((acc, arr) => acc + arr.length, 0);
  assert.equal(total, 2, '木曜のいずれかのゾーンに2日分');
});

import { heatmapLegendHtml } from '../js/chart-helpers.js';

test('heatmapLegendHtml: 稼ぎ時/休憩向き/安定/ムラの語と使い方を含む', () => {
  const html = heatmapLegendHtml('self');
  assert.ok(html.includes('稼ぎ時'));
  assert.ok(html.includes('休憩向き'));
  assert.ok(html.includes('◎'));
  assert.ok(html.includes('△'));
  assert.ok(html.includes('休憩'));
});

test('heatmapLegendHtml: scope=all のとき「みんな」を補足', () => {
  assert.ok(heatmapLegendHtml('all').includes('みんな'));
  assert.ok(!heatmapLegendHtml('self').includes('みんな'));
});

test('heatmapLegendHtml: 数字=時給であることが明記されている', () => {
  const html = heatmapLegendHtml('self');
  assert.ok(html.includes('時給'), '「時給」という語が含まれること');
});

test('heatmapLegendHtml: scope=all のとき「中央値」が含まれる', () => {
  assert.ok(heatmapLegendHtml('all').includes('中央値'));
});

test('heatmapLegendHtml: scope=group も「みんな」凡例（all相当）', () => {
  assert.ok(heatmapLegendHtml('group').includes('みんな'));
  assert.ok(heatmapLegendHtml('group').includes('中央値'));
});

import { heatmapFromCells } from '../js/chart-helpers.js';

test('heatmapFromCells: cellを7×24 matrixの該当[dow][h]に復元', () => {
  const cells = [
    { dow: 1, h: 19, hourlyA: 3000, days: 2, peerValues: [3000, 4000] },
    { dow: 6, h: 2, hourlyA: 5000, days: 3, peerValues: [4000, 5000, 6000] },
  ];
  const m = heatmapFromCells(cells);
  assert.equal(m.length, 7);
  assert.equal(m[0].length, 24);
  assert.deepEqual(m[1][19], { hourlyA: 3000, days: 2, peerValues: [3000, 4000] });
  assert.deepEqual(m[6][2], { hourlyA: 5000, days: 3, peerValues: [4000, 5000, 6000] });
});

test('heatmapFromCells: 未指定セルは空デフォルト {hourlyA:0, days:0, peerValues:[]}', () => {
  const m = heatmapFromCells([{ dow: 0, h: 0, hourlyA: 100, days: 1, peerValues: [100] }]);
  assert.deepEqual(m[3][12], { hourlyA: 0, days: 0, peerValues: [] });
});

test('heatmapFromCells: 空配列でも全セル空デフォルトの7×24', () => {
  const m = heatmapFromCells([]);
  assert.equal(m.length, 7);
  assert.ok(m.every(row => row.length === 24 && row.every(c => c.days === 0 && c.hourlyA === 0 && Array.isArray(c.peerValues))));
});

test('heatmapFromCells: 非配列入力でも空7×24（防御）', () => {
  const m = heatmapFromCells(null);
  assert.equal(m.length, 7);
  assert.equal(m[0][0].days, 0);
});

import { median, peerMedianHourlyDow } from '../js/chart-helpers.js';

test('median: 奇数個の配列は中央値を返す', () => {
  assert.equal(median([1, 3, 2]), 2);
});

test('median: 偶数個の配列は中央2値の平均を返す', () => {
  assert.equal(median([1, 2, 3, 9]), 2.5);
});

test('median: 空配列は0を返す', () => {
  assert.equal(median([]), 0);
});

test('peerMedianHourlyDow: 3人が木19時に各々時給4000/6000/8000 → hourlyA=6000, days=3, peerValues.length=3', () => {
  const mkDrive = (userId, amount) => ({
    _userId: userId,
    date: '2026-04-23', // 木曜
    departureTime: '19:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  // workingMin=60 per driver: hourlyA = amount/(60/60) = amount
  // driver-a: amount=4000 → hourlyA=4000
  // driver-b: amount=6000 → hourlyA=6000
  // driver-c: amount=8000 → hourlyA=8000
  // median([4000,6000,8000]) = 6000
  const drives = [mkDrive('driver-a', 4000), mkDrive('driver-b', 6000), mkDrive('driver-c', 8000)];
  const m = peerMedianHourlyDow(drives);
  const dow = 4; // 木曜
  assert.equal(m[dow][19].hourlyA, 6000, '中央値=6000');
  assert.equal(m[dow][19].days, 3, '3人分');
  assert.equal(m[dow][19].peerValues.length, 3, 'peerValues に3件');
});

test('peerMedianHourlyDow: 多数のdriveを持つ1人が他の少量ドライバーを圧倒しない（人数で中央値）', () => {
  // driver-heavy: 木19時に3日分の乗務だが hourlyA ≈ 10000（高時給）
  // driver-low: 木19時に1日分、hourlyA ≈ 2000
  // driver-mid: 木19時に1日分、hourlyA ≈ 5000
  // pool集計なら heavy に引っ張られるが、peer中央値は [10000, 2000, 5000] の中央値=5000
  const mkDrive = (userId, date, amount) => ({
    _userId: userId,
    date,
    departureTime: '19:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [
    mkDrive('heavy', '2026-04-23', 10000),
    mkDrive('heavy', '2026-04-30', 10000),
    mkDrive('heavy', '2026-05-07', 10000),
    mkDrive('low',   '2026-04-23', 2000),
    mkDrive('mid',   '2026-04-23', 5000),
  ];
  const m = peerMedianHourlyDow(drives);
  // heavy の hourlyA = 10000, low = 2000, mid = 5000 → median=5000
  assert.equal(m[4][19].hourlyA, 5000, 'pool非偏重: 中央値=5000');
});

test('peerMedianHourlyDow: 2人のみのセル → days=2', () => {
  const mkDrive = (userId, amount) => ({
    _userId: userId,
    date: '2026-04-23',
    departureTime: '19:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mkDrive('u1', 4000), mkDrive('u2', 6000)];
  const m = peerMedianHourlyDow(drives);
  assert.equal(m[4][19].days, 2, '2人 → days=2');
});

test('peerMedianHourlyDow: userId フォールバックでもグループ化される', () => {
  const mkDrive = (uid, amount) => ({
    userId: uid, // _userId なし、userId フォールバック
    date: '2026-04-23',
    departureTime: '19:00',
    returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:50', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mkDrive('ua', 3000), mkDrive('ub', 9000)];
  const m = peerMedianHourlyDow(drives);
  assert.equal(m[4][19].days, 2, 'userId フォールバックで2人認識');
  assert.equal(m[4][19].hourlyA, 6000, 'median([3000,9000])=6000');
});

import { dailySalesList, salesStages, stageHeatmap } from '../js/chart-helpers.js';

test('dailySalesList: キャンセル・summary除外、sales/dow正確', () => {
  const drives = [
    { date: '2026-04-23', trips: [ // 木
      { boardTime:'19:00', alightTime:'19:20', amount: 4000, isCancel:false },
      { boardTime:'19:30', alightTime:'19:40', amount: 2000, isCancel:true } // キャンセルは除外
    ], rests: [] },
    { date: '2026-04-24', summaryOnly: true, trips: [], rests: [] } // summary除外
  ];
  const list = dailySalesList(drives);
  assert.equal(list.length, 1);
  assert.equal(list[0].sales, 4000);
  assert.equal(list[0].dow, 4);
  assert.equal(list[0].count, 1);
});

test('salesStages: 1万円刻み境界・端バケット・空ステージ除外', () => {
  const mk = (date, amount) => ({ date, trips:[{boardTime:'10:00',alightTime:'10:10',amount,isCancel:false}], rests:[] });
  const drives = [
    mk('2026-04-01', 48000),  // 〜5万
    mk('2026-04-02', 60000),  // 6–7万 (idx1)
    mk('2026-04-03', 69999),  // 6–7万 (同じ)
    mk('2026-04-04', 70000),  // 7–8万 (idx2)
    mk('2026-04-05', 125000), // 12万+
  ];
  const stages = salesStages(drives);
  const byKey = Object.fromEntries(stages.map(s => [s.label, s.count]));
  assert.equal(byKey['〜5万'], 1);
  assert.equal(byKey['6–7万'], 2);
  assert.equal(byKey['7–8万'], 1);
  assert.equal(byKey['12万+'], 1);
  // 空ステージ(5–6万等)は含まれない
  assert.equal(stages.some(s => s.label === '5–6万'), false);
  // lower昇順
  assert.deepEqual(stages.map(s => s.lower), [...stages.map(s=>s.lower)].sort((a,b)=>a-b));
});

test('stageHeatmap: 平均売上=その曜日のセル売上合計÷該当日数', () => {
  // 木曜の2日。各日 19時に売上(4000, 6000) → 木19時 平均5000
  const mk = (date, amount) => ({
    date, departureTime:'19:00', returnTime:'20:00',
    trips:[{ boardTime:'19:10', alightTime:'19:30', amount, isCancel:false }], rests:[]
  });
  const drives = [ mk('2026-04-23', 4000), mk('2026-04-30', 6000) ]; // 両方木曜
  const { matrix, dowDayCount } = stageHeatmap(drives);
  assert.equal(dowDayCount[4], 2);
  assert.equal(Math.round(matrix[4][19].avgSales), 5000);
});

import { dropoffHistoryAtArea } from '../js/chart-helpers.js';

test('dropoffHistoryAtArea: 単一エリア(string)で従来通り集計できる', () => {
  const drives = [{
    date: '2026-05-22', departureTime:'07:00', returnTime:'22:00',
    trips: [
      { no:1, boardTime:'20:00', alightTime:'20:10', boardPlace:'X1', alightPlace:'大田区蒲田1', amount:3000, isCancel:false },
    ], rests: [],
  }];
  const r = dropoffHistoryAtArea(drives, '大田区蒲田', 20, 1, null, 30);
  assert.equal(r.stats.totalDropoffs, 1);
  assert.deepEqual(r.includedAreas, ['大田区蒲田']);
});

test('dropoffHistoryAtArea: 複数エリア(array)を渡すと範囲全体を集計できる(GPS範囲モード)', () => {
  const drives = [{
    date: '2026-05-22', departureTime:'07:00', returnTime:'22:00',
    trips: [
      { no:1, boardTime:'20:00', alightTime:'20:10', boardPlace:'X1', alightPlace:'大田区蒲田1', amount:3000, isCancel:false },
      { no:2, boardTime:'20:30', alightTime:'20:40', boardPlace:'Y1', alightPlace:'大田区羽田空港2', amount:4000, isCancel:false },
      { no:3, boardTime:'21:00', alightTime:'21:10', boardPlace:'Z1', alightPlace:'新宿区新宿1', amount:5000, isCancel:false },
    ], rests: [],
  }];
  // 蒲田 + 羽田空港 の2エリアを範囲として渡す → 該当2件、範囲外の新宿は除外
  const r = dropoffHistoryAtArea(drives, ['大田区蒲田', '大田区羽田空港'], 20, 1, null, 30);
  assert.equal(r.stats.totalDropoffs, 2);
  assert.equal(r.includedAreas.length, 2);
  // 単一エリアなら1件のみ(後方互換の確認)
  const single = dropoffHistoryAtArea(drives, '大田区蒲田', 20, 1, null, 30);
  assert.equal(single.stats.totalDropoffs, 1);
});

import { tripCountByHour, hourlyActivity } from '../js/chart-helpers.js';

test('tripCountByHour: 乗車時刻の時間で非キャンセル営業をカウント', () => {
  const drive = { trips: [
    { boardTime: '08:10', alightTime: '08:30', amount: 2000, isCancel: false },
    { boardTime: '08:50', alightTime: '09:05', amount: 1500, isCancel: false },
    { boardTime: '09:20', alightTime: '09:40', amount: 1800, isCancel: false },
    { boardTime: '10:00', alightTime: '10:10', amount: 0, isCancel: true },
  ]};
  const counts = tripCountByHour(drive);
  assert.equal(counts[8], 2);
  assert.equal(counts[9], 1);
  assert.equal(counts[10], 0);
});

test('hourlyActivity: 各時間に tripCount を含む', () => {
  const drive = { trips: [
    { boardTime: '08:10', alightTime: '08:30', amount: 2000, isCancel: false },
    { boardTime: '08:50', alightTime: '09:05', amount: 1500, isCancel: false },
  ]};
  const acts = hourlyActivity(drive, 7);
  const h8 = acts.find(a => a.hour === 8);
  assert.equal(h8.tripCount, 2);
});

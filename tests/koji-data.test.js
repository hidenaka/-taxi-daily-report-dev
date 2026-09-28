// 工事マップの材料づくり（純粋な部分）
//
// 元データ: 東京都建設局 路上工事情報（CC BY 4.0）。期間は月単位、時間帯は毎日同じ予定。
// 判定の規則は工事マップ側（osanpo-safety の public/timewindow.js・lanelevel.js・jam.js）と同じ。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  activeAt, periodBounds, parseWindows, inWindows, windowLabel,
  laneLevel, levelInfo, remainingFraction, jamLevel, jamNote,
  periodLabel, selectActive, countByLevel, intersects,
  sideKind, offsetSign, sideLabel, barAlong, toDisplay, stateAt, samplePoints, HEAT_WEIGHT,
} from '../tools/js/koji-data.js';

const jst = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);

const tokyo = {
  id: 'tokyo-abc', title: '外堀通り 地下道工事', restrictionType: 'lane_closure',
  startAt: '2025-10-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z',
  timeWindow: '22:00-6:00', lanesRestricted: 2, lanesTotal: 8, roadSide: '内外',
};

test('都データの期間は「開始月の1日〜終了月の末日」で読む', () => {
  const { start, end } = periodBounds(tokyo);
  assert.equal(start, jst(2025, 10, 1, 0, 0));
  // 終了月(2026年5月)の末日 23:59:59 まで
  assert.ok(end > jst(2026, 5, 31, 23, 0));
  assert.ok(end < jst(2026, 6, 1, 0, 0));
});

test('日をまたぐ時間帯（22:00-6:00）を正しく読む', () => {
  assert.equal(inWindows('22:00-6:00', jst(2026, 1, 10, 23, 0)), true);
  assert.equal(inWindows('22:00-6:00', jst(2026, 1, 10, 3, 0)), true);
  assert.equal(inWindows('22:00-6:00', jst(2026, 1, 10, 12, 0)), false);
  assert.equal(parseWindows('20:00-6:00,9:00-18:00').length, 2);
});

test('時間帯の記載が無い工事は期間中ずっと作業中とみなす', () => {
  const p = { ...tokyo, timeWindow: null };
  assert.equal(activeAt(p, jst(2026, 1, 10, 12, 0)), true);
});

test('期間外・時間外は作業中ではない', () => {
  assert.equal(activeAt(tokyo, jst(2025, 9, 30, 23, 0)), false);   // 開始月の前
  assert.equal(activeAt(tokyo, jst(2026, 6, 1, 0, 30)), false);    // 終了月の翌月
  assert.equal(activeAt(tokyo, jst(2026, 1, 10, 12, 0)), false);   // 昼は時間外
  assert.equal(activeAt(tokyo, jst(2026, 1, 10, 23, 30)), true);
});

test('ふさぎ具合: 通行止め・片側交互・3分の1以上・一部・不明', () => {
  assert.equal(laneLevel({ restrictionType: 'road_closed' }), 'closed');
  assert.equal(laneLevel({ restrictionType: 'lane_closure', lanesRestricted: 4, lanesTotal: 4 }), 'closed');
  assert.equal(laneLevel({ restrictionType: 'alternating_one_way' }), 'alternating');
  assert.equal(laneLevel({ restrictionType: 'lane_closure', lanesRestricted: 2, lanesTotal: 4 }), 'half');
  assert.equal(laneLevel({ restrictionType: 'lane_closure', lanesRestricted: 1, lanesTotal: 8 }), 'part');
  assert.equal(laneLevel({ restrictionType: 'lane_closure' }), 'unknown');
  assert.equal(levelInfo('closed').label, '全面通行止め');
  assert.equal(levelInfo('なにこれ').key, 'unknown');
});

test('残る車線の割合: 片側だけの規制はその向きの車線で見る', () => {
  // 上り側で 8車線中2車線 → 上り4車線のうち2車線が残る = 0.5
  assert.equal(remainingFraction({ restrictionType: 'lane_closure', lanesRestricted: 2, lanesTotal: 8, roadSide: '上' }), 0.5);
  // 上下どちらもなら 8車線中2車線 → 0.75
  assert.equal(remainingFraction({ restrictionType: 'lane_closure', lanesRestricted: 2, lanesTotal: 8, roadSide: '上下' }), 0.75);
  assert.equal(remainingFraction({ restrictionType: 'road_closed' }), 0);
  assert.equal(remainingFraction({ restrictionType: 'lane_closure' }), null);
});

test('混みやすさ: 夜の始まり(20時)は混みやすく、深夜は流れやすい', () => {
  const p = { restrictionType: 'lane_closure', lanesRestricted: 1, lanesTotal: 2, roadSide: '上下' };
  assert.equal(jamLevel(p, 20), 'high');
  assert.equal(jamLevel(p, 3), 'low');
  assert.equal(jamLevel({ restrictionType: 'road_closed' }, 3), 'blocked');
  assert.equal(jamLevel({ restrictionType: 'lane_closure' }, 3), 'unknown');
  assert.equal(jamNote(p, 20), '混みやすい時間');
  assert.equal(jamNote(p, 3), '');
});

test('画面の文字: 時間帯・期間', () => {
  assert.equal(windowLabel('22:00-6:00'), '22:00〜翌6:00');
  assert.equal(windowLabel('9:00-18:00,9:00-18:00'), '9:00〜18:00');
  assert.equal(windowLabel(null), '時間帯の記載なし');
  assert.equal(periodLabel(tokyo), '2025年10月〜2026年5月');
});

test('選ぶ: その時刻に作業中で、地図の範囲に入っているものだけ', () => {
  const f = (id, lng, lat, tw) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { ...tokyo, id, timeWindow: tw },
  });
  const feats = [f('tokyo-1', 139.77, 35.68, '22:00-6:00'), f('tokyo-2', 139.77, 35.68, '9:00-18:00'), f('tokyo-3', 140.9, 35.68, '22:00-6:00')];
  const night = jst(2026, 1, 10, 23, 0);
  assert.deepEqual(selectActive(feats, night).map((x) => x.properties.id), ['tokyo-1', 'tokyo-3']);
  const b = { minLat: 35.6, maxLat: 35.7, minLng: 139.7, maxLng: 139.8 };
  assert.deepEqual(selectActive(feats, night, b).map((x) => x.properties.id), ['tokyo-1']);
  assert.equal(intersects({ type: 'LineString', coordinates: [[139.75, 35.65], [139.9, 35.9]] }, b), true);
});

test('凡例の件数はふさぎ具合ごとに数える', () => {
  const mk = (r, t) => ({ properties: { restrictionType: 'lane_closure', lanesRestricted: r, lanesTotal: t } });
  const n = countByLevel([mk(2, 4), mk(1, 8), mk(4, 4)]);
  assert.equal(n.half, 1); assert.equal(n.part, 1); assert.equal(n.closed, 1); assert.equal(n.unknown, 0);
});

test('どちら側の車線か（推定）: 上り＝都心へ向かう車線・左側', () => {
  // 都心(日本橋)の西で、東へ向かう線（都心へ向かう向き）→ 上りは進行方向の左(-1)
  const mid = [139.70, 35.684];
  assert.equal(sideKind('上'), 'up');
  assert.equal(sideKind('内外'), 'both');
  assert.equal(offsetSign('上', [1, 0], mid), -1);
  assert.equal(offsetSign('下', [1, 0], mid), 1);
  // 都心に対して横向き（南北）の道路は決めない
  assert.equal(offsetSign('上', [0, 1], mid), 0);
  assert.equal(sideLabel('内'), '内回り側（都心寄りの車線）');
});

test('点を道路の向きの短い線にする', () => {
  const [a, b] = barAlong([139.7, 35.68], 90, 25);   // 東向き
  assert.ok(b[0] > a[0]);
  assert.ok(Math.abs(b[1] - a[1]) < 1e-6);
});

test('地図に渡す形: level/side/st が付く', () => {
  const f = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[139.70, 35.684], [139.72, 35.684]] },
    properties: { ...tokyo, roadSide: '上' },
  };
  const night = jst(2026, 1, 10, 23, 0), day = jst(2026, 1, 10, 12, 0);
  const on = toDisplay(f, night), off = toDisplay(f, day);
  assert.equal(on.properties.st, 2);          // 作業中
  assert.equal(off.properties.st, 1);         // 期間中だが時間外
  assert.equal(on.properties.level, 'part');
  assert.equal(on.properties.side, -1);
  assert.equal(stateAt(f.properties, jst(2025, 9, 1, 23, 0)), 0);   // 期間外
});

test('遠目の濃淡用: 線は約150mごとの点にばらす', () => {
  const g = { type: 'LineString', coordinates: [[139.70, 35.684], [139.71, 35.684], [139.72, 35.684]] };
  const pts = samplePoints(g);
  assert.ok(pts.length >= 3);
  assert.deepEqual(samplePoints({ type: 'Point', coordinates: [139.7, 35.6] }), [[139.7, 35.6]]);
  assert.equal(HEAT_WEIGHT.closed, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  localFrame, axisOf, signalsAlong, curveFromPoints, slopeFromProfile, onStructure, demValue, demTileOf,
} from '../.github/scripts/lib/road-shape.mjs';
import { readPng } from '../.github/scripts/lib/read-png.mjs';
import { addRoadShape } from '../.github/scripts/lib/koji-road-shape.mjs';
import { roadShape } from '../tools/js/koji-lane-scene.js';

const MID = [139.7, 35.68];
const north = localFrame(MID, 0);
const at = (t, u = 0) => north.toLonLat(t, u);

test('道の向きに沿った距離 t と右へのずれ u が往復で一致する', () => {
  const f = localFrame(MID, 60);
  const q = f.toTU(f.toLonLat(40, -7));
  assert.ok(Math.abs(q.t - 40) < 0.01 && Math.abs(q.u + 7) < 0.01);
  assert.ok(north.toTU(at(0, 10)).u > 9.9);    // 北向きの右＝東
});

test('線の工事は始点→終点、点の工事は roadBearing が道の向き', () => {
  const line = { geometry: { type: 'LineString', coordinates: [at(-50), at(0), at(50)] }, properties: {} };
  assert.ok(Math.abs(axisOf(line).bearing) < 0.5 || Math.abs(axisOf(line).bearing - 360) < 0.5);
  assert.equal(axisOf({ geometry: { type: 'Point', coordinates: MID }, properties: { roadBearing: 90 } }).bearing, 90);
  assert.equal(axisOf({ geometry: { type: 'Point', coordinates: MID }, properties: {} }), null);
});

test('信号: 道から離れたものは数えず、同じ交差点の信号は1つにまとめる', () => {
  const s = [at(-80, 5), at(-70, -6), at(40, 3), at(10, 60), at(200, 0)];
  assert.deepEqual(signalsAlong(north, s), [-75, 40]);
});

test('カーブ: まっすぐなら0度、右へ曲がる道は＋', () => {
  const straight = []; const right = [];
  for (let t = -150; t <= 150; t += 15) { straight.push({ t, u: 0 }); right.push({ t, u: 0.002 * t * t }); }
  assert.equal(Math.abs(curveFromPoints(straight)), 0);
  const c = curveFromPoints(right);
  assert.ok(c > 40 && c < 60, String(c));
  assert.equal(curveFromPoints(right.filter((q) => q.t < 0)), null);   // 片側しか点が無い
});

test('坂: 上りは＋、標高が飛ぶ所（橋など）と急すぎる値は出さない', () => {
  const prof = (f) => Array.from({ length: 11 }, (_, i) => ({ t: -100 + i * 20, z: f(-100 + i * 20) }));
  assert.equal(slopeFromProfile(prof((t) => 10 + t * 0.04)), 4);
  assert.equal(slopeFromProfile(prof((t) => (t > 0 ? 15 : 10))), null);
  assert.equal(slopeFromProfile(prof((t) => 10 + t * 0.2)), null);
  assert.equal(onStructure(north, [{ k: 'b', c: [at(30, 2)] }]), true);
  assert.equal(onStructure(north, [{ k: 'b', c: [at(30, 80)] }]), false);
});

test('標高タイル: 画素の値と PNG の読み取り', () => {
  assert.equal(demValue(0, 3, 232), 10);
  assert.equal(demValue(128, 0, 0), null);
  assert.ok(Math.abs(demValue(255, 255, 156) + 1) < 1e-9);
  const k = demTileOf(139.7, 35.68);
  assert.deepEqual([k.x, k.y], [29099, 12903]);
  // 2×1 の RGB PNG を作って読む
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([1, 0, 3, 232, 5, 0, 0]);   // フィルタ1（左との差）
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const im = readPng(png);
  assert.deepEqual(im.rgb(0, 0), [0, 3, 232]);
  assert.deepEqual(im.rgb(1, 0), [5, 3, 232]);
});

test('工事に信号・カーブ・坂を足す（標高タイルが取れない所は坂だけ出さない）', async () => {
  const lines = [{ n: '試し通り', main: true, c: Array.from({ length: 21 }, (_, i) => at(-150 + i * 15, 0.002 * (-150 + i * 15) ** 2)) }];
  const data = { signals: [at(60, 4)], structures: [], lines };
  const f1 = { geometry: { type: 'LineString', coordinates: [at(-40), at(0), at(40)] }, properties: { title: '試し通り 道路工事' } };
  const f2 = { geometry: { type: 'Point', coordinates: MID }, properties: { title: '試し通り 水道工事' } };   // 向きが無い
  const tile = { rgb: () => [0, 3, 232] };      // どこでも 10m（平ら）
  const r = await addRoadShape([f1, f2], { data, fetchTile: async () => tile });
  assert.equal(f1.properties.sigAt, '60');
  assert.ok(f1.properties.curveDeg > 30);
  assert.equal(f1.properties.slopePct, 0);
  assert.equal(f2.properties.sigAt, undefined);
  assert.equal(r.signals, 1);
  const f3 = { geometry: { type: 'LineString', coordinates: [at(-40), at(40)] }, properties: { title: '試し通り' } };
  await addRoadShape([f3], { data, fetchTile: async () => { throw new Error('つながらない'); } });
  assert.equal(f3.properties.slopePct, undefined);
  assert.equal(f3.properties.sigAt, '60');
});

test('絵の向き: ふさぐ側が線の右なら、→ の車は線と逆向きに走るので値を裏返す', () => {
  assert.deepEqual(roadShape({ sigAt: '-80,45', curveDeg: 30, slopePct: 4, side: -1 }), { sig: [-80, 45], curve: 30, slope: 4, road: null, dirs: null });
  assert.deepEqual(roadShape({ sigAt: '-80,45', curveDeg: 30, slopePct: 4, side: 1 }), { sig: [-45, 80], curve: -30, slope: -4, road: null, dirs: null });
  assert.deepEqual(roadShape({}), { sig: [], curve: null, slope: null, road: null, dirs: null });
});

test('koji.json: 道の形の値が範囲に収まっている', async () => {
  const { readFileSync } = await import('node:fs');
  const F = JSON.parse(readFileSync(new URL('../tools/data/koji.json', import.meta.url), 'utf8')).features;
  // 道の形は毎朝の取り込み（sync-koji）で足すので、まだ足していない koji.json でも通す（値があるときだけ範囲を見る）
  for (const { properties: p } of F) {
    if (p.sigAt != null) for (const t of String(p.sigAt).split(',')) assert.ok(Math.abs(Number(t)) <= 150, p.id);
    if (p.curveDeg != null) assert.ok(Math.abs(p.curveDeg) <= 180, p.id);
    if (p.slopePct != null) assert.ok(Math.abs(p.slopePct) <= 12, p.id);
    if (p.roadU != null) assert.equal(String(p.roadU).split(',').length, 31, p.id);
  }
});

test('道の形: 道の線をなぞり、工事の所を 0 にそろえる。上下線の2本を行き来しない', async () => {
  const { roadProfile, curveFromProfile } = await import('../.github/scripts/lib/road-shape.mjs');
  // 右へ曲がる道（u = t²/1000 + 3）と、10m 右に並ぶ反対向きの線
  const arc = []; for (let t = -160; t <= 160; t += 20) arc.push(at(t, (t * t) / 1000 + 3));
  const pair = arc.map(([lon, lat]) => [lon + 0.0001, lat]);
  const prof = roadProfile(north, [{ n: '目白通り', main: true, c: arc }, { n: '目白通り', main: true, c: pair }], '目白通り');
  assert.equal(prof.length, 31);
  assert.equal(prof[15], 0);
  assert.ok(prof[0] > 18 && prof[30] > 18, `両端が右へ: ${prof[0]}, ${prof[30]}`);
  for (let i = 1; i < 31; i++) assert.ok(Math.abs(prof[i] - prof[i - 1]) < 5);
  assert.ok(curveFromProfile(prof) > 20);
  // 線がまっすぐなら 0 のまま
  const flat = roadProfile(north, [{ n: 'x', main: true, c: [at(-200), at(200)] }], 'x');
  assert.ok(flat.every((v) => v === 0));
  assert.equal(curveFromProfile(flat), 0);
});

test('道の形は、→ の車が線と逆向きなら前後と左右を入れかえる', () => {
  const u = Array.from({ length: 31 }, (_, i) => (i === 30 ? 9 : 0)).join(',');
  assert.deepEqual(roadShape({ roadU: u, side: -1 }).road.at(-1), { t: 150, u: 9 });
  assert.deepEqual(roadShape({ roadU: u, side: 1 }).road[0], { t: -150, u: -9 });
});

test('方面: 道の向きの先 600m〜6km にある街。向きが合わない・遠すぎる街は使わない', async () => {
  const { towardPlace } = await import('../.github/scripts/lib/road-shape.mjs');
  const P = [['近い北', 139.7, 35.69], ['遠い北', 139.7, 35.78], ['東', 139.72, 35.68], ['すぐそこ', 139.7, 35.682]];
  assert.equal(towardPlace([139.7, 35.68], 0, P), '近い北');
  assert.equal(towardPlace([139.7, 35.68], 90, P), '東');
  assert.equal(towardPlace([139.7, 35.68], 180, P), '');
});

test('方面は道をたどって選ぶ: 曲がる道は曲がった先の街・道が終わる先の街は出さない', async () => {
  const { makeRoadTracer } = await import('../.github/scripts/lib/road-shape.mjs');
  // 北へ 2km 行って、ゆるく東へ曲がる道。まっすぐ北の先には「北の街」、曲がった先に「東の街」
  const lines = [{ n: 'L通り', main: true, c: [[139.7, 35.68], [139.7, 35.695], [139.701, 35.697], [139.703, 35.698], [139.74, 35.698]] }];
  const P = [['北の街', 139.7, 35.715], ['東の街', 139.735, 35.699], ['南の街', 139.7, 35.66]];
  const tr = makeRoadTracer(lines);
  assert.equal(tr.placeAlong([139.7, 35.681], 0, ['L通り'], P), '東の街');
  assert.equal(tr.placeAlong([139.7, 35.681], 180, ['L通り'], P), '');      // 南は道がすぐ終わる
  assert.equal(tr.placeAlong([139.7, 35.681], 0, ['別の通り'], P), '');     // 線に無い名前の道はたどらない
  assert.equal(tr.placeAlong([139.7, 35.681], 0, ['別の通り', 'L通り'], P), '東の街');   // 「A・B」はどちらでも
});

test('絵の → ・← の車が向かう方面（→ の車が線と逆向きなら入れかえる）', async () => {
  const { compass8, dirText } = await import('../tools/js/koji-lane-scene.js');
  assert.equal(compass8(0), '北'); assert.equal(compass8(44), '北東'); assert.equal(compass8(-90), '西'); assert.equal(compass8(359), '北');
  const a = roadShape({ axisDeg: 30, axisTo: '新宿', axisFrom: '品川', side: -1 });
  assert.deepEqual(a.dirs, { right: { compass: '北東', place: '新宿' }, left: { compass: '南西', place: '品川' } });
  const b = roadShape({ axisDeg: 30, axisTo: '新宿', side: 1 });
  assert.equal(dirText(b.dirs.right), '南西へ');
  assert.equal(dirText(b.dirs.left), '新宿方面');
});

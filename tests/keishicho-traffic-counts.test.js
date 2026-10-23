// 警視庁 定期交通量調査（主要交差点・区部）の変換・座標・生成物の検査
//
// 固定データ: tests/fixtures/keishicho/
//   kousaten_0704_*.csv  公式 ZIP から取り出した南千束（704）の3種の CSV（CP932 のまま）
//   kousaten_9999_*.csv  試験用の小さな地点（'-'・空欄・見出しの無い CSV・合計の食い違い・記号の無い方向）
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  parseCount, parseHour, parseApproach, parseMovement, splitCrossRoads, surveyMonthIso, parseCsv,
  buildPoint, validatePublicData, peakHour, approachSummary, surveyMonthLabel, fmtCount, HOURS,
  shortCount, arrowWidthM, arrowPolygon, offsetPoint,
} from '../tools/js/traffic-count-data.js';
import { readZip } from '../.github/scripts/lib/read-zip.mjs';
import { convert, groupCsvFiles, stableJson } from '../.github/scripts/build-keishicho-traffic-counts.mjs';
import { nameKeys, roadKeys, distToSeg, locatePoint } from '../.github/scripts/locate-keishicho-points.mjs';
import { assignArms, clusterBearings, angleDiff, armCodes } from '../.github/scripts/locate-keishicho-arms.mjs';

const FIX = new URL('./fixtures/keishicho/', import.meta.url);
const sjis = new TextDecoder('shift_jis');
const raw = (name) => readFileSync(new URL(name, FIX));
const text = (name) => sjis.decode(raw(name));
const p704 = () => buildPoint({
  houkou: text('kousaten_0704_houkou.csv'),
  ryuusyutu: text('kousaten_0704_ryuusyutu.csv'),
  jitensya: text('kousaten_0704_jitensya.csv'),
});
const p9999 = () => buildPoint({
  houkou: text('kousaten_9999_houkou.csv'),
  ryuusyutu: text('kousaten_9999_ryuusyutu.csv'),
  jitensya: text('kousaten_9999_jitensya.csv'),
});

// ---- セルの読み方 ----

test('値: 数字は数、「-」と空欄は null（0 にしない）、読めない値は undefined', () => {
  assert.equal(parseCount('123'), 123);
  assert.equal(parseCount(' 0 '), 0);
  assert.equal(parseCount('１２'), 12);          // 全角数字
  assert.equal(parseCount('-'), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount('abc'), undefined);
});

test('時間帯: 7〜18時と「12時間計」だけを読む', () => {
  assert.equal(parseHour('7'), 7);
  assert.equal(parseHour('18'), 18);
  assert.equal(parseHour('12時間計'), 'total');
  assert.equal(parseHour('19'), null);
  assert.equal(parseHour('流入計'), null);
});

test('方向: 「A 五反田」は記号と名前、「トンネル」は名前を記号として使う', () => {
  assert.deepEqual(parseApproach('A 五反田'), { code: 'A', label: '五反田' });
  assert.deepEqual(parseApproach('トンネル'), { code: 'トンネル', label: 'トンネル' });
  assert.deepEqual(parseMovement('1.平和島'), { no: 1, label: '平和島' });
  assert.deepEqual(parseMovement('1平和島'), { no: 1, label: '平和島' });   // 自転車の CSV の書き方
  assert.deepEqual(parseMovement('流入計'), { total: true });
});

test('交差道路名と調査年月', () => {
  assert.deepEqual(splitCrossRoads('環七通りＸ中原街道'), ['環七通り', '中原街道']);
  assert.deepEqual(splitCrossRoads('明治通り×京葉道路'), ['明治通り', '京葉道路']);
  assert.equal(surveyMonthIso('R6/11'), '2024-11');
  assert.equal(surveyMonthIso('H30/1'), null);
  assert.equal(surveyMonthLabel({ surveyYearMonth: 'R6/11' }), '2024年（令和6年）11月');
});

test('見出しの行が無い CSV は、いつもの見出しで読んで印を立てる', () => {
  const r = parseCsv(' 9999,試験,甲Ｘ乙,R6/11,試験,A 北,7,1,0,1,0,2,0', ['地点番号', '地点名']);
  assert.equal(r.headerMissing, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]['地点名'], '試験');
});

// ---- 南千束（704）: 公式 CSV と照合 ----

test('南千束 704: 地点の基本情報（CP932 の日本語を正しく読む）', () => {
  const { point, issues } = p704();
  assert.equal(point.pointId, 704);
  assert.equal(point.name, '南千束');
  assert.equal(point.crossRoadsRaw, '環七通りX中原街道');
  assert.deepEqual(point.crossRoads, ['環七通り', '中原街道']);
  assert.equal(point.surveyYearMonth, 'R6/11');
  assert.equal(point.surveyMonth, '2024-11');
  assert.equal(point.policeStation, '田園調布');
  assert.deepEqual(point.surveyHours, { start: 7, end: 19, label: '7時〜19時（12時間）' });
  assert.deepEqual(issues, []);   // 公式の表の中の合計はすべて合う
  assert.equal(point.totalSource, 'official');
  assert.equal(point.totalsDiffer, false);
});

test('南千束 704: 12時間計・時間別・方向別・流出別・自転車が公式 CSV の値と一致', () => {
  const { point } = p704();
  // 流入計（4方向）の12時間計を足したもの = 流出の全方向合計（公式 CSV: 四輪計 56784）
  assert.equal(point.total12h.fourWheel, 56784);
  assert.equal(point.total12h.twoWheel, 4293);
  assert.equal(point.hourly.length, 12);
  assert.deepEqual(point.hourly.map((h) => h.hour), HOURS);
  assert.equal(point.hourly[0].fourWheel, 5467);   // 7時台の4方向の合計
  const byCode = Object.fromEntries(point.approaches.map((a) => [a.code, a]));
  assert.deepEqual(Object.keys(byCode), ['A', 'B', 'C', 'D']);
  assert.equal(byCode.A.label, '五反田');
  assert.equal(byCode.A.total12h.fourWheel, 11266);
  assert.equal(byCode.D.total12h.fourWheel, 16321);
  assert.deepEqual(byCode.A.movements.map((m) => [m.no, m.label, m.total12h.fourWheel]),
    [[1, '平和島', 1132], [2, '丸子橋', 8186], [3, '大原', 1948]]);
  // 車種区分（公式 CSV の 大型乗用・大型貨物・普通乗用・普通貨物・四輪計・二輪車）が全部ある
  assert.deepEqual(Object.keys(byCode.A.total12h), ['largePassenger', 'largeCargo', 'passenger', 'cargo', 'fourWheel', 'twoWheel']);
  assert.equal(byCode.A.hourly[0].fourWheel + byCode.B.hourly[0].fourWheel + byCode.C.hourly[0].fourWheel + byCode.D.hourly[0].fourWheel, 5467);
  assert.deepEqual(point.exits.map((e) => [e.code, e.total12h.fourWheel]), [['A', 14294], ['B', 15091], ['C', 12009], ['D', 15390]]);
  assert.equal(point.bicycle.present, true);
  assert.deepEqual(point.bicycle.total12h, { onRoad: 749, onSidewalk: 3266, total: 4015 });
});

test('南千束 704: 画面用の要約（いちばん多い時間帯・方向の並び）', () => {
  const { point } = p704();
  const peak = peakHour(point);
  assert.ok(HOURS.includes(peak.hour));
  assert.ok(point.hourly.every((h) => h.fourWheel <= peak.fourWheel));
  const s = approachSummary(point);
  assert.equal(s[0].fourWheel, 16531);   // B 大原 がいちばん多い
  assert.equal(fmtCount(56784), '56,784');
  assert.equal(fmtCount(null), '—');
});

// ---- 試験用の地点: 欠損・食い違い ----

test('欠損: 空欄と「-」は 0 にせず null のまま。数のある車種だけ足す', () => {
  const { point } = p9999();
  const a = point.approaches.find((x) => x.code === 'A');
  assert.equal(a.movements[0].total12h.twoWheel, null);     // 二輪車は空欄 → null
  assert.equal(a.hourly.find((h) => h.hour === 8).twoWheel, null);   // 流入計の行の空欄も null
  assert.equal(point.bicycle.present, true);
  assert.deepEqual(point.bicycle.total12h, { onRoad: 24, onSidewalk: null, total: null });  // '-' → null
  assert.ok(point.approaches.some((x) => x.code === 'トンネル'));
});

test('合計の食い違い: 地点番号と差の分かるメモを出す（勝手に直さない）', () => {
  const { point, issues } = p9999();
  assert.ok(issues.length > 0);
  assert.ok(issues.every((i) => i.pointId === 9999));
  const m = issues.find((i) => i.message.includes('12時間計') && i.message.includes('流入計と流出先ごとの合計が合わない'));
  assert.ok(m, JSON.stringify(issues));
  assert.match(m.message, /大型乗用 表=13 再計算=12/);
  assert.ok(issues.some((i) => i.message.includes('見出しの行が無い')));
  assert.equal(a12(point), 13);   // 表の値はそのまま残す
  function a12(p) { return p.approaches.find((x) => x.code === 'A').total12h.largePassenger; }
});

test('見出しの合計は公式の「全方向合計」。足し直した合計とは分けて持ち、違えば印を立てる', () => {
  const { point, issues } = p9999();
  assert.equal(point.totalSource, 'official');
  assert.equal(point.total12h.largePassenger, 12);        // 流出方向別の全方向合計（公式）
  assert.equal(point.inflowSum12h.largePassenger, 13);    // 流入計を足し直した値
  assert.equal(point.totalsDiffer, true);
  assert.ok(issues.some((i) => i.message.includes('流出の全方向合計（公式）') && i.message.includes('12時間計')));
});

test('流入計の行が無い方向（側道など）は、印を付けて黙って抜かない', () => {
  const houkou = text('kousaten_9999_houkou.csv').split('\n').filter((l) => !l.includes('トンネル')).join('\n')
    + Array.from({ length: 12 }, (_, i) => ` 9999,試験１,甲通りＸ乙通り,R6/11,試験,側道,9.南,${i + 7},1,0,0,0,1,0`).join('\n')
    + '\n 9999,試験１,甲通りＸ乙通り,R6/11,試験,側道,9.南,12時間計,12,0,0,0,12,0\n';
  const { point } = buildPoint({ houkou, ryuusyutu: text('kousaten_9999_ryuusyutu.csv') });
  assert.deepEqual(point.approachesWithoutTotal, ['側道']);
});

// ---- ZIP（ファイル名が CP932） ----

function cp932Name(s) {
  // テスト用: 'kousaten_' などの英数字はそのまま、日本語は既知のバイト列で
  return Buffer.from(s, 'latin1');
}
function makeZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = f.nameBytes; const data = deflateRawSync(f.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.utf8 ? 0x800 : 0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const fixtureZip = () => makeZip([
  ...['houkou', 'ryuusyutu', 'jitensya'].map((k) => ({ nameBytes: cp932Name(`704/kousaten_0704_${k}.csv`), data: raw(`kousaten_0704_${k}.csv`) })),
  ...['houkou', 'ryuusyutu', 'jitensya'].map((k) => ({ nameBytes: cp932Name(`9999/kousaten_9999_${k}.csv`), data: raw(`kousaten_9999_${k}.csv`) })),
  // CP932 のファイル名（「交差点区部.txt」）。UTF-8 の印が無いので CP932 として読む
  { nameBytes: Buffer.concat([Buffer.from([0x8c, 0xf0, 0x8d, 0xb7, 0x93, 0x5f, 0x8b, 0xe6, 0x95, 0x94]), Buffer.from('.txt')]), data: Buffer.from('x') },
]);

test('ZIP: CP932 のファイル名を読み、地点ごとに3種の CSV にまとめる', () => {
  const entries = readZip(fixtureZip());
  assert.equal(entries.length, 7);
  assert.ok(entries.some((e) => e.name === '交差点区部.txt'));
  const { byPoint, ignored } = groupCsvFiles(entries);
  assert.deepEqual([...byPoint.keys()].sort((a, b) => a - b), [704, 9999]);
  assert.deepEqual(ignored, ['交差点区部.txt']);
  assert.equal(byPoint.get(704).houkou.text.split('\n')[1].split(',')[1], '南千束');
});

// ---- 変換全体 ----

const COORDS = {
  704: { lat: 35.603679, lon: 139.697571, coordinateStatus: 'verified-visual', coordinateCheckedAt: '2026-10-22', coordinateSource: '試験' },
  9999: { lat: 35.7, lon: 139.7, coordinateStatus: 'candidate-roads', coordinateCheckedAt: '2026-10-22', note: '要・目視' },
};
const runConvert = () => convert({ entries: readZip(fixtureZip()), zipFileName: 'x.zip', zipSha256: 'abc', fetchedAt: '2026-10-22', coords: COORDS });

test('変換: 確認済みの座標の地点だけを地図用に入れ、残りは未配置として品質レポートへ', () => {
  const { doc, report } = runConvert();
  assert.deepEqual(doc.meta.counts, { converted: 2, shown: 1, unplaced: 1, withArms: 0 });
  assert.equal(doc.points[0].armBearings, undefined);
  assert.deepEqual(doc.points.map((p) => p.pointId), [704]);
  assert.equal(doc.points[0].coordinateStatus, 'verified-visual');
  assert.deepEqual(report.unplaced.map((u) => [u.pointId, u.coordinateStatus]), [[9999, 'candidate-roads']]);
  assert.ok(report.issues.some((i) => i.pointId === 9999));
  assert.deepEqual(validatePublicData(doc), []);
  // 出典・取得日・版を残す
  for (const k of ['sourceUrl', 'sourcePage', 'attribution', 'fetchedAt', 'zipFileName', 'zipSha256', 'scriptVersion']) assert.ok(doc.meta[k], k);
  assert.deepEqual(doc.meta.surveyYearMonths, ['R6/11']);
});

test('変換: 同じ入力からは並び順を含め同じ JSON になる', () => {
  assert.equal(stableJson(runConvert().doc), stableJson(runConvert().doc));
  assert.equal(stableJson(runConvert().report), stableJson(runConvert().report));
});

test('変換スクリプト: 別々に2回実行して、書き出したファイルがバイト単位で同じ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keishicho-'));
  const zip = join(dir, 'in.zip'); writeFileSync(zip, fixtureZip());
  const coords = join(dir, 'coords.json'); writeFileSync(coords, JSON.stringify({ points: COORDS }));
  const script = new URL('../.github/scripts/build-keishicho-traffic-counts.mjs', import.meta.url).pathname;
  const run = (n) => {
    const out = join(dir, `out${n}.json`); const rep = join(dir, `rep${n}.json`);
    execFileSync(process.execPath, [script, '--zip', zip, '--fetched-at', '2026-10-22', '--coords', coords, '--out', out, '--report', rep], { stdio: 'pipe' });
    return [readFileSync(out), readFileSync(rep)];
  };
  const [o1, r1] = run(1); const [o2, r2] = run(2);
  assert.ok(o1.equals(o2));
  assert.ok(r1.equals(r2));
  assert.equal(JSON.parse(o1).points[0].pointId, 704);
});

test('生成物の検査: 範囲外・未確認・重複を見つける', () => {
  const { doc } = runConvert();
  const bad = structuredClone(doc);
  bad.points.push({ ...bad.points[0] });
  bad.points[1].lat = 34.0;
  bad.points[1].coordinateStatus = 'candidate-roads';
  const errs = validatePublicData(bad);
  assert.ok(errs.some((e) => e.includes('重複')));
  assert.ok(errs.some((e) => e.includes('範囲外')));
  assert.ok(errs.some((e) => e.includes('確認済みでない')));
  assert.ok(errs.some((e) => e.includes('counts.shown')));
});

// ---- 座標の決め方 ----

test('座標: 交差点名の言い換えと、確かめられない道路名', () => {
  assert.deepEqual(nameKeys('赤坂１').sort(), ['赤坂1', '赤坂1丁目', '赤坂1交差点', '赤坂一', '赤坂一丁目'].sort());
  assert.deepEqual(roadKeys('（明治通り）'), ['明治通り']);
  assert.deepEqual(roadKeys('中仙道'), ['中山道', '中仙道']);
  assert.equal(roadKeys('0'), null);
  assert.equal(roadKeys('都道450号'), null);
  assert.equal(roadKeys('臨港道路'), null);
});

test('座標: 名前の点の近くに2本の道路が両方あるときだけ「確認済み（OSM）」', () => {
  const roads = [
    { properties: { n: '環七通り' }, geometry: { type: 'LineString', coordinates: [[139.6960, 35.6030], [139.6990, 35.6045]] } },
    { properties: { n: '中原街道' }, geometry: { type: 'LineString', coordinates: [[139.6965, 35.6045], [139.6985, 35.6028]] } },
  ];
  const pt = { name: '南千束', crossRoads: ['環七通り', '中原街道'] };
  const near = new Map([['南千束', [{ id: 1, lat: 35.60368, lon: 139.69757 }]]]);
  const r = locatePoint(pt, { signalIndex: near, roads, checkedAt: '2026-10-22' });
  assert.equal(r.coordinateStatus, 'verified-osm');
  assert.match(r.coordinateSource, /node\/1/);
  // 同じ名前でも道路から離れた点は確認済みにしない（名前だけで置かない）
  const far = new Map([['南千束', [{ id: 2, lat: 35.62, lon: 139.72 }]]]);
  const r2 = locatePoint(pt, { signalIndex: far, roads, checkedAt: '2026-10-22' });
  assert.notEqual(r2.coordinateStatus, 'verified-osm');
  assert.notEqual(r2.coordinateStatus, 'verified-visual');
  assert.ok(distToSeg([139.6975, 35.6037], [139.6975, 35.6030], [139.6975, 35.6045]) < 1);
});

// ---- 公開用の生成物（tools/data/keishicho-traffic-counts.json） ----

const GEN = new URL('../tools/data/keishicho-traffic-counts.json', import.meta.url);

test('生成物: スキーマ・地点番号の重複なし・座標の範囲と根拠・南千束がある', () => {
  const doc = JSON.parse(readFileSync(GEN, 'utf8'));
  assert.deepEqual(validatePublicData(doc), []);
  assert.equal(doc.meta.counts.shown, doc.points.length);
  assert.equal(doc.meta.counts.converted, doc.meta.counts.shown + doc.meta.counts.unplaced);
  const ids = doc.points.map((p) => p.pointId);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const p = doc.points.find((x) => x.pointId === 704);
  assert.ok(p, '南千束（704）が入っていない');
  assert.equal(p.name, '南千束');
  assert.equal(p.surveyYearMonth, 'R6/11');
  assert.equal(p.total12h.fourWheel, 56784);
  // 環七通り×中原街道の交差点（南千束）付近
  assert.ok(Math.abs(p.lat - 35.6037) < 0.0008 && Math.abs(p.lon - 139.6976) < 0.0008, `${p.lat},${p.lon}`);
  assert.equal(p.coordinateStatus, 'verified-visual');
  assert.ok(p.coordinateSource.includes('航空写真'));
  // 見出しの合計はすべて公式の値。松原橋（703）は足し直すと合わない地点の例
  assert.ok(doc.points.every((x) => x.totalSource === 'official'));
  const m = doc.points.find((x) => x.pointId === 703);
  if (m) { assert.equal(m.total12h.fourWheel, 60270); assert.equal(m.totalsDiffer, true); }
});

// ---- 流入方向の向き（地図の矢印） ----

test('向き: 目で確かめた地点だけ armBearings を持ち、検査で形を確かめる', () => {
  const arms = { 704: { status: 'verified-visual', bearings: { A: 49, B: 328, C: 234, D: 146 } } };
  const { doc } = convert({ entries: readZip(fixtureZip()), zipFileName: 'x.zip', zipSha256: 'abc', fetchedAt: '2026-10-22', coords: COORDS, arms });
  assert.deepEqual(doc.points[0].armBearings, { A: 49, B: 328, C: 234, D: 146 });
  assert.equal(doc.meta.counts.withArms, 1);
  assert.deepEqual(validatePublicData(doc), []);
  const auto = convert({ entries: readZip(fixtureZip()), zipFileName: 'x.zip', zipSha256: 'abc', fetchedAt: '2026-10-22', coords: COORDS, arms: { 704: { status: 'auto', bearings: { A: 1, B: 2, C: 3, D: 4 } } } }).doc;
  assert.equal(auto.points[0].armBearings, undefined, '目で確かめていない向きは入れない');
  const bad = structuredClone(doc); bad.points[0].armBearings = { A: 49, B: 400, C: 234 };
  const errs = validatePublicData(bad);
  assert.ok(errs.some((e) => e.includes('0〜359')));
  assert.ok(errs.some((e) => e.includes('方向 D')));
});

test('向き: 方向記号は反時計回り。A の位置を方向の地名に合わせて選ぶ', () => {
  const clusters = [{ b: 45, w: 6 }, { b: 135, w: 6 }, { b: 225, w: 6 }, { b: 315, w: 6 }];
  const arms = [{ code: 'A', geo: { b: 40 } }, { code: 'B', geo: { b: 320 } }, { code: 'C', geo: null }, { code: 'D', geo: { b: 120 } }];
  const r = assignArms(arms, clusters);
  assert.deepEqual(r.bearings, [45, 315, 225, 135]);
  assert.deepEqual(r.virtual, [false, false, false, false]);
  // 上下線が分かれた道は1本の腕にまとめる
  const merged = clusterBearings([{ b: 358, w: 3 }, { b: 6, w: 3 }, { b: 90, w: 2 }]);
  assert.equal(merged.length, 2);
  assert.ok(angleDiff(merged.find((c) => c.w === 6).b, 2) < 1);
  // 流入と流出の記号をまとめ、記号の順に並べる
  assert.deepEqual(armCodes({ approaches: [{ code: 'B', label: 'b' }, { code: 'A', label: 'a' }], exits: [{ code: 'C', label: 'c' }] }).map((a) => a.code), ['A', 'B', 'C']);
});

test('地図の形: 矢印は交差点へ向かい、太さは台数で増える。台数の短い書き方', () => {
  const c = [139.7, 35.6];
  const ring = arrowPolygon(c, 90, { fromM: 26, toM: 150, widthM: 20 });
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  const mx = 111320 * Math.cos((35.6 * Math.PI) / 180);
  const xs = ring.map(([x]) => (x - 139.7) * mx);
  assert.ok(Math.abs(Math.min(...xs) - 26) < 0.5, '先端は東へ26m');
  assert.ok(Math.abs(Math.max(...xs) - 150) < 0.5, '根元は東へ150m');
  const [ox, oy] = offsetPoint(c, 0, 100);
  assert.equal(ox, 139.7); assert.ok(Math.abs((oy - 35.6) * 110540 - 100) < 0.01);
  assert.equal(arrowWidthM(0), 0);
  assert.ok(arrowWidthM(16000) > arrowWidthM(4000));
  assert.ok(arrowWidthM(1e7) <= 46);
  assert.equal(shortCount(56784), '5.7万');
  assert.equal(shortCount(120000), '12万');
  assert.equal(shortCount(8186), '8,186');
  assert.equal(shortCount(null), '—');
});

test('生成物の向き: 南千束は五反田=北東・大原=北西・丸子橋=南西・平和島=南東。どの地点も反時計回り', () => {
  const doc = JSON.parse(readFileSync(GEN, 'utf8'));
  const p = doc.points.find((x) => x.pointId === 704);
  const inRange = (v, lo, hi) => v >= lo && v <= hi;
  assert.ok(inRange(p.armBearings.A, 20, 80) && inRange(p.armBearings.B, 290, 350) && inRange(p.armBearings.C, 200, 260) && inRange(p.armBearings.D, 110, 170), JSON.stringify(p.armBearings));
  assert.equal(doc.meta.counts.withArms, doc.points.filter((x) => x.armBearings).length);
  assert.ok(doc.meta.counts.withArms >= 55);
  for (const x of doc.points.filter((q) => q.armBearings)) {
    // 同じ向き（立体の上下）を除いて、A→B→C… は反時計回り（向きの差を足すと1周＝360度）
    const bs = [...new Set(Object.keys(x.armBearings).sort().map((k) => x.armBearings[k]))];
    const turn = bs.reduce((s, b, i) => s + ((bs[i] - bs[(i + 1) % bs.length] + 360) % 360), 0);
    assert.equal(turn, 360, `${x.pointId} ${x.name} ${JSON.stringify(x.armBearings)}`);
  }
});

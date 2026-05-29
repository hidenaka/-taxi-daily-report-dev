import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isLateNight, findAreasByQuery, lookupArea, computeBounds, projectLatLng,
  buildCardModel, formatFare, validateFares
} from '../tools/js/airport-fare-data.js';

const AREAS = [
  { key: 'chiyoda', name: '千代田区', lat: 35.694, lng: 139.753 },
  { key: 'shibuya', name: '渋谷区',   lat: 35.664, lng: 139.698 },
  { key: 'musashino', name: '武蔵野市', lat: 35.718, lng: 139.566 }
];

test('isLateNight: 22:00 と 04:59 は深夜、05:00 と 21:59 は昼', () => {
  assert.equal(isLateNight(new Date('2026-05-29T22:00:00')), true);
  assert.equal(isLateNight(new Date('2026-05-29T04:59:00')), true);
  assert.equal(isLateNight(new Date('2026-05-29T05:00:00')), false);
  assert.equal(isLateNight(new Date('2026-05-29T21:59:00')), false);
  assert.equal(isLateNight(new Date('2026-05-29T12:00:00')), false);
});

test('findAreasByQuery: 部分一致（区名）、空クエリは全件', () => {
  assert.deepEqual(findAreasByQuery(AREAS, '渋').map(a => a.key), ['shibuya']);
  assert.deepEqual(findAreasByQuery(AREAS, '武蔵').map(a => a.key), ['musashino']);
  assert.equal(findAreasByQuery(AREAS, '').length, 3);
  assert.equal(findAreasByQuery(AREAS, 'なし').length, 0);
});

test('lookupArea: key で取得、無ければ null', () => {
  assert.equal(lookupArea(AREAS, 'shibuya').name, '渋谷区');
  assert.equal(lookupArea(AREAS, 'xxx'), null);
});

test('computeBounds: 緯度経度の min/max', () => {
  const b = computeBounds(AREAS);
  assert.equal(b.minLng, 139.566);
  assert.equal(b.maxLng, 139.753);
  assert.equal(b.minLat, 35.664);
  assert.equal(b.maxLat, 35.718);
});

test('projectLatLng: 西端は左、北端は上に投影される', () => {
  const b = computeBounds(AREAS);
  const size = { w: 100, h: 100 };
  const west = projectLatLng({ lat: 35.69, lng: 139.566 }, b, size, 0);
  const east = projectLatLng({ lat: 35.69, lng: 139.753 }, b, size, 0);
  assert.ok(west.x < east.x, '西は東より x が小さい');
  const north = projectLatLng({ lat: 35.718, lng: 139.65 }, b, size, 0);
  const south = projectLatLng({ lat: 35.664, lng: 139.65 }, b, size, 0);
  assert.ok(north.y < south.y, '北は南より y が小さい（上）');
});

const AREA = {
  key: 'shibuya', name: '渋谷区', lat: 35.664, lng: 139.698,
  haneda: { day: 6900, night: 8100 },
  narita: { day: 24000, night: null }
};

test('formatFare: 数値は ¥カンマ区切り、null は —', () => {
  assert.equal(formatFare(6900), '¥6,900');
  assert.equal(formatFare(null), '—');
});

test('buildCardModel: 深夜帯は isLate=true、昼帯は false', () => {
  const night = buildCardModel(AREA, new Date('2026-05-29T23:00:00'));
  assert.equal(night.isLate, true);
  assert.equal(night.name, '渋谷区');
  assert.equal(night.haneda.day, 6900);
  assert.equal(night.narita.night, null);
  const day = buildCardModel(AREA, new Date('2026-05-29T13:00:00'));
  assert.equal(day.isLate, false);
});

test('validateFares: 25件・各4料金フィールド必須、欠ければ throw', () => {
  const good = { areas: Array.from({ length: 25 }, (_, i) => ({
    key: 'k' + i, name: 'n' + i, lat: 35.7, lng: 139.7,
    haneda: { day: 1, night: 2 }, narita: { day: 3, night: 4 }
  })) };
  assert.equal(validateFares(good), true);

  const tooFew = { areas: good.areas.slice(0, 24) };
  assert.throws(() => validateFares(tooFew), /25/);

  const missingField = { areas: good.areas.map((a, i) =>
    i === 0 ? { ...a, haneda: { day: 1 } } : a) };
  assert.throws(() => validateFares(missingField), /haneda\.night/);
});

test('airport-fixed-fares.json: 25件で validateFares を通る', () => {
  const path = fileURLToPath(new URL('../tools/data/airport-fixed-fares.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.areas.length, 25);
  assert.equal(validateFares(data), true);
  const keys = new Set(data.areas.map(a => a.key));
  assert.equal(keys.size, 25, 'key は一意');
  assert.ok(keys.has('musashino') && keys.has('mitaka'), '武蔵野・三鷹を含む');
});

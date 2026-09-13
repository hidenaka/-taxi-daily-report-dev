// 地図のまん中が「どこか」を住所で出すための材料
//
// 国土地理院の逆ジオコーダ（緯度経度 → 市区町村コード + 町名）を使う。
// 市区町村コード→名前の表は tools/data/muni.json に同梱（1,919件）。
import { test } from 'node:test';
import assert from 'node:assert';
import { reverseGeocodeUrl, formatCenterAddress } from '../tools/js/radar-data.js';

test('問い合わせ先は緯度経度つきのURL', () => {
  const u = reverseGeocodeUrl(35.5494, 139.7798);
  assert.ok(u.startsWith('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?'));
  assert.ok(u.includes('lat=35.5494'));
  assert.ok(u.includes('lon=139.7798'));
});

test('東京の中なら、市区町村＋町名で出す', () => {
  assert.equal(formatCenterAddress('東京都,大田区', '羽田空港三丁目'), '大田区羽田空港三丁目');
});

test('東京の外なら、都道府県から出す', () => {
  assert.equal(formatCenterAddress('福岡県,福岡市', '博多駅前'), '福岡県福岡市博多駅前');
  assert.equal(formatCenterAddress('神奈川県,川崎市', '殿町'), '神奈川県川崎市殿町');
});

test('町名が取れなければ市区町村だけ', () => {
  assert.equal(formatCenterAddress('東京都,大田区', ''), '大田区');
  assert.equal(formatCenterAddress('東京都,大田区', null), '大田区');
});

test('市区町村が分からなければ町名だけ', () => {
  assert.equal(formatCenterAddress(null, '羽田空港三丁目'), '羽田空港三丁目');
});

test('どちらも無ければ空', () => {
  assert.equal(formatCenterAddress(null, null), '');
  assert.equal(formatCenterAddress('', ''), '');
});

test('政令市の区名に付く空白は取る', () => {
  // 市区町村名が「横浜市　中区」のように全角空白つき（対応表に171件ある）
  assert.equal(formatCenterAddress('神奈川県,横浜市　中区', '英町'), '神奈川県横浜市中区英町');
  assert.equal(formatCenterAddress('福岡県,福岡市　中央区', '天神一丁目'), '福岡県福岡市中央区天神一丁目');
  // 町名側に空白が付く場合も取る
  assert.equal(formatCenterAddress('神奈川県,横浜市', '　中区英町'), '神奈川県横浜市中区英町');
});

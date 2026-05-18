import { test, assert } from './run.js';
import { parseFormattedReport } from '../js/parser.js';
import { readFileSync } from 'node:fs';

test('parseFormattedReport: ヘッダー4項目を抽出', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-04-26');
  assert.equal(r.vehicleType, 'premium');
  assert.equal(r.departureTime, '07:00');
  assert.equal(r.returnTime, '01:16');
});

test('parseFormattedReport: trips 2件・rests 1件を抽出', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips.length, 2);
  assert.equal(r.rests.length, 1);
});

test('parseFormattedReport: 引用符付き金額をパース', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips[0].amount, 3600);
  assert.equal(r.trips[1].amount, 2100);
});

test('parseFormattedReport: 男女列を無視して正しく合計列を取る', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.trips[0].boardPlace, '大田区上池台4');
  assert.equal(r.trips[0].alightPlace, '港区港南2');
  assert.equal(r.trips[0].km, 6.7);
});

test('parseFormattedReport: 不完全ヘッダーでも data 部分は処理', () => {
  const text = '日付: 2026-04-26\n---\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n1,07:00,07:10,0:10,,A,B,1.0,,,"500"';
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-04-26');
  assert.equal(r.vehicleType, '');
  assert.equal(r.trips.length, 1);
});

test('parseFormattedReport: 区切り線なし＆ヘッダー4行揃えば後続を data 扱い', () => {
  const text = '日付: 2026-04-26\n車種: premium\n出庫: 07:00\n帰庫: 23:00\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n1,07:00,07:10,0:10,,A,B,1.0,,,"500"';
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-04-26');
  assert.equal(r.trips.length, 1);
});

test('parseFormattedReport: ヘッダーがまったく無ければthrow', () => {
  const text = '何かのテキスト\nだけがある';
  assert.throws(() => parseFormattedReport(text), /ヘッダー/);
});

test('parseFormattedReport: em-dash (—) 区切りも受け入れる', () => {
  const text = '日付: 2026-04-26\n車種: premium\n出庫: 07:00\n帰庫: 23:00\n—\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n1,07:00,07:10,0:10,,A,B,1.0,,,"500"';
  const r = parseFormattedReport(text);
  assert.equal(r.trips.length, 1);
});

test('parseFormattedReport: 「貸N」行を isCharter:true でパース', () => {
  const text = '日付: 2026-04-26\n車種: premium\n出庫: 07:00\n帰庫: 23:00\n---\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n貸1,09:32,11:46,2:14,,千代田区六番町,千代田区六番町,20.9,1,,"16,000"';
  const r = parseFormattedReport(text);
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0].no, 1);
  assert.equal(r.trips[0].isCharter, true);
  assert.equal(r.trips[0].amount, 16000);
});

test('parseFormattedReport: 区切り線なし＋空行があってもCSVと判定する', () => {
  // 帰庫行と表の間が --- ではなく空行のケース。空行を先頭行と誤読してタブ形式判定 → クラッシュしていた
  const text = '日付: 2026-05-17\n車種: premium\n出庫: 07:09\n帰庫: 23:37\n\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n休,07:09,07:35,0:25,,大田区北馬込1,,,,,\n1,07:37,07:57,0:20,迎,A,B,10.0,1,,"5,500"';
  const r = parseFormattedReport(text);
  assert.equal(r.trips.length, 1);
  assert.equal(r.rests.length, 1);
  assert.equal(r.trips[0].boardTime, '07:37');
});

test('parseFormattedReport: ## マークダウン見出し付きヘッダーでも日付を抽出', () => {
  const text = '## 日付: 2026-05-17\n車種: premium\n出庫: 07:00\n帰庫: 23:00\n---\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n1,07:00,07:10,0:10,,A,B,1.0,,,"500"';
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-05-17');
  assert.equal(r.trips.length, 1);
});

test('parseFormattedReport: ##見出し＋区切り線なし＋空行（実データ相当）', () => {
  const text = '## 日付: 2026-05-17\n車種:\n出庫: 07:09\n帰庫: 23:37\n\nNo,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計\n休,07:09,07:35,0:25,,大田区北馬込1,,,,,\n1,07:37,07:57,0:20,迎,大田区北馬込2,大田区羽田空港3,10.0,1,,"5,500"';
  const r = parseFormattedReport(text);
  assert.equal(r.date, '2026-05-17');
  assert.equal(r.rests.length, 1);
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0].boardTime, '07:37');
});

test('parseFormattedReport: rawText に元テキストをそのまま含む', () => {
  const text = readFileSync('tests/fixtures/sample-formatted.txt', 'utf-8');
  const r = parseFormattedReport(text);
  assert.equal(r.rawText, text);
});

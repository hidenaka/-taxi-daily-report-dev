// 営業明細の「回」(回送) が、休憩とも営業とも混ざらないことのテスト。
//
// 直した不具合 (2026-09-01 本人報告「1番左の回が休に勝手に置き換えられている」):
//   回送行は No 欄に「回」と印字されているのに、その字を一切見ていなかった。
//   区別は行の形だけに頼っていた ——「乗車と降車が同時刻なら回送、経過があれば休憩」。
//   実際の回送は数分かかることがあり、その瞬間に休憩へ化けていた。
//   さらに降車地を持つ回送は営業に数えられ、営業回数が水増しされていた。
import { test } from "node:test";
import assert from "node:assert";
import { rowsToDrive, isRevenueTrip } from "./to-drive.js";
import { normalizeCell } from "./template-reconstruct.js";

// 回送行の素の形: 乗車地はあるが、降車地・km・金額が無い
const kaiso = (over = {}) => ({
  No: "回",
  乗車: "11:00",
  降車: "11:00",
  乗車地: "港区港南2",
  降車地: "",
  営Km: "",
  合計: "",
  ...over,
});

// --- 休憩に化けない ---

test("回送: 乗車と降車が同時刻なら、これまでどおり休憩でも営業でもない", () => {
  const { trips, rests } = rowsToDrive([kaiso()]);
  assert.equal(rests.length, 0);
  assert.equal(trips.length, 0);
});

test("回送: 1分でも経過があっても休憩にしない（本人報告の不具合）", () => {
  const { trips, rests } = rowsToDrive([kaiso({ 降車: "11:01" })]);
  assert.equal(rests.length, 0, "休憩に数えてはいけない");
  assert.equal(trips.length, 0, "営業にも数えない");
});

test("回送: 20分かかっても休憩にしない", () => {
  const { rests } = rowsToDrive([kaiso({ 降車: "11:20" })]);
  assert.equal(rests.length, 0);
});

// --- 営業にも化けない ---

test("回送: 降車地があっても営業に数えない（営業回数の水増し防止）", () => {
  const { trips, rests } = rowsToDrive([
    kaiso({ 降車地: "大田区羽田空港3", 降車: "11:20" }),
  ]);
  assert.equal(trips.length, 0, "営業に数えてはいけない");
  assert.equal(rests.length, 0);
});

test("isRevenueTrip: 回送は km や金額を持っていても営業ではない", () => {
  assert.equal(isRevenueTrip({ isKaiso: true, km: 5, amount: 2000 }), false);
  assert.equal(isRevenueTrip({ isKaiso: true, no: 3 }), false);
});

// --- 休憩と営業は従来どおり ---

test("休憩: 「休」と読めた行はこれまでどおり休憩", () => {
  const { rests } = rowsToDrive([kaiso({ No: "休", 降車: "13:56", 乗車: "13:00" })]);
  assert.equal(rests.length, 1);
});

test("休憩: No が読めなくても、降車地も金額も無く経過がある行は休憩", () => {
  const { rests } = rowsToDrive([kaiso({ No: "", 乗車: "13:00", 降車: "13:56" })]);
  assert.equal(rests.length, 1);
});

test("営業: 通常のトリップは影響を受けない", () => {
  const { trips, rests } = rowsToDrive([{
    No: "5", 乗車: "9:00", 降車: "9:20",
    乗車地: "港区港南2", 降車地: "渋谷区渋谷1", 営Km: "5.2", 合計: "2300",
  }]);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 0);
  assert.equal(trips[0].amount, 2300);
});

// --- 混在した1日ぶん ---

test("回送・休憩・営業が混ざった明細を正しく分ける", () => {
  const { trips, rests } = rowsToDrive([
    { No: "1", 乗車: "9:00", 降車: "9:20", 乗車地: "A", 降車地: "B", 営Km: "5.2", 合計: "2300" },
    kaiso({ 乗車: "9:25", 降車: "9:31" }),                       // 経過ありの回送
    { No: "休", 乗車: "12:00", 降車: "12:45", 乗車地: "C", 降車地: "", 営Km: "", 合計: "" },
    { No: "2", 乗車: "13:00", 降車: "13:30", 乗車地: "D", 降車地: "E", 営Km: "8.0", 合計: "3400" },
    kaiso({ 乗車: "14:00", 降車: "14:10", 降車地: "F" }),          // 降車地つきの回送
  ]);
  assert.equal(trips.length, 2, "営業は2件");
  assert.equal(rests.length, 1, "休憩は1回");
  assert.deepEqual(trips.map((t) => t.amount), [2300, 3400]);
});

// --- No 欄の正規化 ---

test("normalizeCell int: 「回」は数字に潰さずそのまま残す", () => {
  assert.equal(normalizeCell("回", "int", 0.9).text, "回");
});

test("normalizeCell int: 「休」「貸」の従来の扱いは変わらない", () => {
  assert.equal(normalizeCell("休", "int", 0.9).text, "休");
  assert.equal(normalizeCell("保", "int", 0.9).text, "休");
  assert.equal(normalizeCell("貸1", "int", 0.9).text, "貸1");
});

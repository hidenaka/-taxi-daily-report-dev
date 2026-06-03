// to-drive.js のテスト。特に「非営業行（回送・ETC明細）の混入で営業回数が膨らむ」
// バグ（実画像 IMG_1522 で 52件→本来33件）の回帰防止。
import { test } from "node:test";
import assert from "node:assert";
import { rowsToDrive, isRevenueTrip } from "./to-drive.js";

const realRow = {
  No: "1", 乗車: "8:18", 降車: "8:24",
  乗車地: "大田区上池台5", 降車地: "品川区旗の台1",
  営Km: "2.2", 合計: "1,700",
};
// 回送: 番号なし・乗降同時刻・0円0km・降車地なし
const kaisoRow = {
  No: "", 乗車: "8:56", 降車: "8:56",
  乗車地: "目黒区平町2", 降車地: "", 営Km: "", 合計: "",
};
// ETC明細行: 時刻列が1つ（降車時刻なし）。番号も金額もあるがトリップではない
const etcRow = {
  No: "5", 乗車: "10:18", 降車: "",
  乗車地: "代々木", 降車地: "渋谷区宇田川町", 営Km: "6.6", 合計: "4,100",
};
// 番号付きだがEND列ズレで中身が空に見える行 → 番号があるので残す
const numberedEmptyRow = {
  No: "2", 乗車: "8:35", 降車: "8:47",
  乗車地: "品川区旗の台4", 降車地: "", 営Km: "", 合計: "",
};
const restRow = { No: "休", 乗車: "8:56", 降車: "9:50", 乗車地: "目黒区南3" };

test("rowsToDrive: 回送(番号なし0円0km降車地なし)はtripsに数えない", () => {
  const { trips } = rowsToDrive([realRow, kaisoRow]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].no, 1);
});

test("rowsToDrive: ETC明細行(降車時刻なし)はtripsに数えない", () => {
  const { trips } = rowsToDrive([realRow, etcRow]);
  assert.equal(trips.length, 1);
});

test("rowsToDrive: 番号付き行は中身が空でも残す(END列ズレ救済)", () => {
  const { trips } = rowsToDrive([numberedEmptyRow]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].no, 2);
});

test("rowsToDrive: 休憩はrestに入りtripsに混ざらない", () => {
  const { trips, rests } = rowsToDrive([realRow, restRow]);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 1);
  assert.equal(rests[0].startTime, "8:56");
});

test("rowsToDrive: 混在(本物2・回送1・ETC1・休1)→ trips=2, rests=1", () => {
  const { trips, rests } = rowsToDrive([realRow, kaisoRow, etcRow, numberedEmptyRow, restRow]);
  assert.equal(trips.length, 2);
  assert.equal(rests.length, 1);
});

test("isRevenueTrip: キャンセル(0円でも降車地あり)は残す", () => {
  assert.equal(isRevenueTrip({ boardTime: "9:00", alightTime: "9:05", no: 7, amount: 0, km: 0, alightPlace: "港区平町2", isCancel: true }), true);
});

test("isRevenueTrip: 両時刻が揃わない行は除外", () => {
  assert.equal(isRevenueTrip({ boardTime: "10:18", alightTime: "", no: 5, amount: 4100, km: 6.6, alightPlace: "渋谷区宇田川町" }), false);
});

test("isRevenueTrip: 番号も内容も無い行は除外", () => {
  assert.equal(isRevenueTrip({ boardTime: "8:56", alightTime: "8:56", no: null, amount: 0, km: 0, alightPlace: "" }), false);
});

// to-drive.js のテスト。
// 営業回数の水増し(ETC明細・回送の混入)と、その修正で起きた退行
// (斜め撮影で降車時刻が空→本物トリップまで落として0件)の両方の回帰防止。
// 方針: ETC明細は reconstructRows の etcY 位置カットで本表から除外する(boxes基準・
//        実画像で担保)。to-drive の isRevenueTrip は「回送・空行」だけ落とす。
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
// 番号付きだがEND列ズレで中身が空に見える行 → 番号があるので残す
const numberedEmptyRow = {
  No: "2", 乗車: "8:35", 降車: "8:47",
  乗車地: "品川区旗の台4", 降車地: "", 営Km: "", 合計: "",
};
// 斜め撮影で列がズレ「降車時刻」が空になった本物トリップ → 番号/内容があるので残す
const skewedNoAlightRow = {
  No: "853", 乗車: "8:53", 降車: "",
  乗車地: "大田区西蒲田7", 降車地: "大田区池上6", 営Km: "3.3", 合計: "2,800",
};
const restRow = { No: "休", 乗車: "8:56", 降車: "9:50", 乗車地: "目黒区南3" };

test("rowsToDrive: 回送(番号なし0円0km降車地なし)はtripsに数えない", () => {
  const { trips } = rowsToDrive([realRow, kaisoRow]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].no, 1);
});

test("rowsToDrive: 番号付き行は中身が空でも残す(END列ズレ救済)", () => {
  const { trips } = rowsToDrive([numberedEmptyRow]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].no, 2);
});

test("rowsToDrive: 斜め撮影で降車時刻が空でも本物トリップは残す(退行防止)", () => {
  const { trips } = rowsToDrive([skewedNoAlightRow]);
  assert.equal(trips.length, 1, "降車時刻なしでも番号/内容があれば落とさない");
});

test("rowsToDrive: 休憩はrestに入りtripsに混ざらない", () => {
  const { trips, rests } = rowsToDrive([realRow, restRow]);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 1);
  assert.equal(rests[0].startTime, "8:56");
});

test("rowsToDrive: 混在(本物2・回送1・休1)→ trips=2, rests=1", () => {
  const { trips, rests } = rowsToDrive([realRow, kaisoRow, numberedEmptyRow, restRow]);
  assert.equal(trips.length, 2);
  assert.equal(rests.length, 1);
});

test("isRevenueTrip: キャンセル(0円でも)は残す", () => {
  assert.equal(isRevenueTrip({ boardTime: "9:00", alightTime: "9:05", no: 7, amount: 0, km: 0, alightPlace: "港区平町2", isCancel: true }), true);
});

test("isRevenueTrip: 降車時刻が無くても番号があれば残す(斜め撮影救済)", () => {
  assert.equal(isRevenueTrip({ boardTime: "8:53", alightTime: "", no: 853, amount: 2800, km: 3.3, alightPlace: "大田区池上6" }), true);
});

test("isRevenueTrip: 番号が無くても内容(金額/km/降車地)があれば残す", () => {
  assert.equal(isRevenueTrip({ boardTime: "8:53", alightTime: "", no: null, amount: 2800, km: 3.3, alightPlace: "大田区池上6" }), true);
});

test("isRevenueTrip: 番号も内容も無い行(回送/空行)は除外", () => {
  assert.equal(isRevenueTrip({ boardTime: "8:56", alightTime: "8:56", no: null, amount: 0, km: 0, alightPlace: "" }), false);
});

// --- No連番補正 ---
import { correctTripNumbers } from "./to-drive.js";

test("correctTripNumbers: 連番に挟まれた外れ値を補正(1,21,3→1,2,3)", () => {
  const trips = [{ no: 1 }, { no: 21 }, { no: 3 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [1, 2, 3]);
});

test("correctTripNumbers: 6,1,8 の真ん中は7に補正", () => {
  const trips = [{ no: 6 }, { no: 1 }, { no: 8 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [6, 7, 8]);
});

test("correctTripNumbers: 連続した外れ値も前から順に補正", () => {
  const trips = [{ no: 1 }, { no: 21 }, { no: 3 }, { no: 4 }, { no: 1 }, { no: 6 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [1, 2, 3, 4, 5, 6]);
});

test("correctTripNumbers: 正しい連番は変えない", () => {
  const trips = [{ no: 1 }, { no: 2 }, { no: 3 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [1, 2, 3]);
});

test("correctTripNumbers: 正当なギャップ(行欠落)は触らない", () => {
  const trips = [{ no: 1 }, { no: 2 }, { no: 4 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [1, 2, 4]);
});

test("correctTripNumbers: null(キャンセル等)は飛ばす", () => {
  const trips = [{ no: 1 }, { no: null }, { no: 3 }];
  correctTripNumbers(trips);
  assert.deepEqual(trips.map(t => t.no), [1, null, 3]);
});

test("rowsToDrive: No外れ値を連番補正して返す", () => {
  const rows = [
    { No: "1", 乗車: "8:18", 降車: "8:24", 降車地: "港区", 営Km: "2", 合計: "1700" },
    { No: "21", 乗車: "8:35", 降車: "8:47", 降車地: "港区", 営Km: "4", 合計: "2700" },
    { No: "3", 乗車: "8:47", 降車: "8:56", 降車地: "港区", 営Km: "1", 合計: "600" },
  ];
  const { trips } = rowsToDrive(rows);
  assert.deepEqual(trips.map(t => t.no), [1, 2, 3]);
});

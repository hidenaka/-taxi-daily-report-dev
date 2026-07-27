// 「様式が固定である」ことを使って、読めなかったセルを構造から補うテスト。
//
// 背景（2026-07-27）:
// 画質が悪い写真では No 列（本文よりさらに小さい文字）と 休 の字が読めない。
// ただし営業明細は固定様式なので、次の2つは読まなくても分かる:
//   (1) No は必ず 1..N の連番で、行の並び順と一致する
//   (2) 休憩行は「時刻と場所はあるが、降車地・km・金額が無い行」
// 実際 LINE 圧縮された写真では、行と金額は全て正しく取れているのに
// No の一部（11/12 が空・13→12 の誤読）と休憩 3 件が落ちていた。
import { test } from "node:test";
import assert from "node:assert";
import { rowsToDrive, renumberTripsByOrder } from "./to-drive.js";

// 明細1行ぶんの生データを作る
const row = (o) => ({
  No: "", 乗車: "", 降車: "", 時間: "", 迎: "", 乗車地: "", 降車地: "",
  営Km: "", 男: "", 女: "", 合計: "", 料金: "", 現収: "", 未収: "", 立替: "", 備考: "",
  _flags: {}, _raw: {}, ...o,
});
const trip = (no, t, place, dest, amount) =>
  row({ No: no, 乗車: t, 降車: t, 迎: "迎", 乗車地: place, 降車地: dest, 営Km: "2.0", 合計: String(amount) });

test("renumberTripsByOrder: 大半が並び順どおりなら、読めなかった/誤読した No を並び順で振り直す", () => {
  // 11・12 が読めず、13 を 12 と誤読したケース（実写真で発生）
  const trips = [{ no: 1 }, { no: 2 }, { no: null }, { no: null }, { no: 12 }, { no: 6 }];
  renumberTripsByOrder(trips);
  assert.deepEqual(trips.map((t) => t.no), [1, 2, 3, 4, 5, 6]);
});

test("renumberTripsByOrder: 行そのものを取りこぼしている疑いがあるときは触らない", () => {
  // 4件目が丸ごと欠落 → 並び順と番号が系統的にずれる。勝手に詰めない。
  const trips = [{ no: 1 }, { no: 2 }, { no: 3 }, { no: 5 }, { no: 6 }, { no: 7 }];
  renumberTripsByOrder(trips);
  assert.deepEqual(trips.map((t) => t.no), [1, 2, 3, 5, 6, 7]);
});

test("renumberTripsByOrder: 番号がほとんど読めない明細では触らない", () => {
  const trips = [{ no: null }, { no: null }, { no: null }, { no: null }];
  renumberTripsByOrder(trips);
  assert.deepEqual(trips.map((t) => t.no), [null, null, null, null]);
});

test("rowsToDrive: 「休」の字が読めなくても、降車地も金額も無い行は休憩として拾う", () => {
  const rows = [
    trip("1", "8:43", "品川区戸越6", "渋谷区広尾5", 3100),
    // 休憩行（No が読めていない・降車地/km/金額なし・滞在時間あり）
    row({ No: "", 乗車: "13:44", 降車: "15:00", 時間: "1:15", 乗車地: "港区六本木7" }),
    trip("2", "15:07", "港区南麻布5", "港区南青山1", 5100),
  ];
  const { trips, rests } = rowsToDrive(rows);
  assert.equal(trips.length, 2, "営業は2件のまま");
  assert.equal(rests.length, 1, "休憩として拾う");
  assert.equal(rests[0].startTime, "13:44");
  assert.equal(rests[0].place, "港区六本木7");
});

test("rowsToDrive: 「休」が 体/试/仕 に化けていても行の形で休憩と分かる", () => {
  const rows = [
    trip("1", "8:43", "品川区戸越6", "渋谷区広尾5", 3100),
    row({ No: "体", 乗車: "20:45", 降車: "21:45", 時間: "1:00", 乗車地: "川崎市中原区上小田中6" }),
    row({ No: "试", 乗車: "23:48", 降車: "0:19", 時間: "0:30", 乗車地: "港区芝3" }),
  ];
  const { trips, rests } = rowsToDrive(rows);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 2);
});

test("rowsToDrive: 番号が潰れた営業行は休憩にしない（降車地や金額を持つため）", () => {
  const rows = [
    trip("1", "8:43", "品川区戸越6", "渋谷区広尾5", 3100),
    row({ No: "", 乗車: "9:10", 降車: "9:43", 乗車地: "目黒区上目黒3", 降車地: "大田区羽田空港3", 営Km: "25.5", 合計: "11570" }),
  ];
  const { trips, rests } = rowsToDrive(rows);
  assert.equal(trips.length, 2);
  assert.equal(rests.length, 0);
});

test("rowsToDrive: 回送行（乗車と降車が同時刻＝滞在時間ゼロ）は休憩にしない", () => {
  const rows = [
    trip("1", "8:43", "品川区戸越6", "渋谷区広尾5", 3100),
    row({ No: "", 乗車: "11:00", 降車: "11:00", 時間: "0:00", 乗車地: "港区港南2" }),
  ];
  const { trips, rests } = rowsToDrive(rows);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 0, "回送は休憩ではない");
});

test("rowsToDrive: 「休」が読めている行は従来どおり休憩（退行防止）", () => {
  const rows = [
    trip("1", "8:43", "品川区戸越6", "渋谷区広尾5", 3100),
    row({ No: "休", 乗車: "13:00", 降車: "13:56", 時間: "0:56", 乗車地: "大田区羽田空港3" }),
  ];
  const { trips, rests } = rowsToDrive(rows);
  assert.equal(trips.length, 1);
  assert.equal(rests.length, 1);
  assert.equal(rests[0].place, "大田区羽田空港3");
});

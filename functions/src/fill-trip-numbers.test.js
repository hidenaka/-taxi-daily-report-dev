// No（営業回数の連番）欠落の補完テスト。
//
// 明細用紙にパンチ穴が開いていると No セルが物理的に潰れて読めない
// （2026/06/18 の明細では No.11/12 が穴で消えた）。営業明細の No は 1..N の
// 連番なので、前後から一意に決まるときだけ補完する。
import { test } from "node:test";
import assert from "node:assert";
import { fillMissingTripNumbers } from "./to-drive.js";

// no の配列から trips 配列を作る簡易ヘルパ
const T = (nos) => nos.map((no) => ({ no }));

test("fillMissingTripNumbers: パンチ穴で連続2行の No が欠落しても前後から補完する", () => {
  const trips = T([9, 10, null, null, 13, 14]);
  fillMissingTripNumbers(trips, ["9", "10", "", "", "13", "14"]);
  assert.deepEqual(trips.map((t) => t.no), [9, 10, 11, 12, 13, 14]);
});

test("fillMissingTripNumbers: 1行だけの読み落とし(誤読で空)も補完する", () => {
  const trips = T([3, null, 5]);
  fillMissingTripNumbers(trips, ["3", "A", "5"]);
  assert.deepEqual(trips.map((t) => t.no), [3, 4, 5]);
});

test("fillMissingTripNumbers: 末尾の欠落は直前からの連番で補完する", () => {
  const trips = T([26, 27, null]);
  fillMissingTripNumbers(trips, ["26", "27", ""]);
  assert.deepEqual(trips.map((t) => t.no), [26, 27, 28]);
});

test("fillMissingTripNumbers: 先頭の欠落は直後から逆算して補完する", () => {
  const trips = T([null, null, 3, 4]);
  fillMissingTripNumbers(trips, ["", "", "3", "4"]);
  assert.deepEqual(trips.map((t) => t.no), [1, 2, 3, 4]);
});

test("fillMissingTripNumbers: 前後の番号差と欠落数が合わないときは補完しない", () => {
  // 10 と 13 の間は 2 行ぶんのはずが 1 行しか無い＝行自体を取りこぼしている。
  // 誤った番号を作らないよう触らない。
  const trips = T([10, null, 13]);
  fillMissingTripNumbers(trips, ["10", "", "13"]);
  assert.deepEqual(trips.map((t) => t.no), [10, null, 13]);
});

test("fillMissingTripNumbers: 先頭欠落で 1 未満になる場合は補完しない", () => {
  const trips = T([null, null, 1]);
  fillMissingTripNumbers(trips, ["", "", "1"]);
  assert.deepEqual(trips.map((t) => t.no), [null, null, 1]);
});

test("fillMissingTripNumbers: キャンセル行(No 欄が「キ」)は番号を持たないので補完しない", () => {
  const trips = T([5, null, 6]);
  fillMissingTripNumbers(trips, ["5", "キ", "6"]);
  assert.deepEqual(trips.map((t) => t.no), [5, null, 6]);
});

test("fillMissingTripNumbers: 番号が全く読めない明細では何もしない", () => {
  const trips = T([null, null, null]);
  fillMissingTripNumbers(trips, ["", "", ""]);
  assert.deepEqual(trips.map((t) => t.no), [null, null, null]);
});

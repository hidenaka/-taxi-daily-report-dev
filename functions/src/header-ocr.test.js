// functions/src/header-ocr.test.js
// parseHeaderBoxes（純粋関数）の高速ユニットテスト。OCRは実行しない。
import test from "node:test";
import assert from "node:assert/strict";
import { parseHeaderBoxes } from "./header-ocr.js";

// 2026-05-19の実OCR検証で得た実際のボックス座標（拡大後座標系）の関連抜粋。
// 走行KM(309) と 実車KM(170) を両方含め、混同しないことを確認する。
const realBoxes = [
  { text: "処理日付", bbox: [579, 259, 760, 290], confidence: 0.9 },
  { text: "2026/05/10", bbox: [536, 341, 720, 372], confidence: 0.9 },
  { text: "出庫日時", bbox: [2050, 213, 2230, 244], confidence: 0.9 },
  { text: "5/1007:07", bbox: [2022, 302, 2210, 333], confidence: 0.9 },
  { text: "入庫日時", bbox: [3100, 196, 3280, 227], confidence: 0.9 },
  { text: "5/1100:39", bbox: [3069, 283, 3260, 314], confidence: 0.9 },
  { text: "走行KM", bbox: [1554, 444, 1700, 475], confidence: 0.9 },
  { text: "实車KM", bbox: [1329, 449, 1470, 480], confidence: 0.9 },
  { text: "309", bbox: [1655, 512, 1720, 543], confidence: 0.9 },
  { text: "170", bbox: [1431, 518, 1496, 549], confidence: 0.9 },
];

test("実OCRボックスから4項目を抽出する", () => {
  const h = parseHeaderBoxes(realBoxes);
  assert.equal(h.date, "2026-05-10");
  assert.equal(h.departTime, "07:07");
  assert.equal(h.returnTime, "00:39");
  assert.equal(h.totalKm, 309);
});

test("走行KMと実車KMを混同しない（実車KM値を拾わない）", () => {
  const h = parseHeaderBoxes(realBoxes);
  assert.equal(h.totalKm, 309); // 170(実車KM) ではない
});

test("ボックスが空なら全項目 null", () => {
  const h = parseHeaderBoxes([]);
  assert.deepEqual(h, { date: null, departTime: null, returnTime: null, totalKm: null });
});

test("ラベルだけで値が無ければ該当項目は null", () => {
  const h = parseHeaderBoxes([
    { text: "処理日付", bbox: [579, 259, 760, 290], confidence: 0.9 },
    { text: "走行KM", bbox: [1554, 444, 1700, 475], confidence: 0.9 },
  ]);
  assert.equal(h.date, null);
  assert.equal(h.totalKm, null);
});

test("出庫日時が時刻のみ（日付なし）でも時刻を拾う", () => {
  const h = parseHeaderBoxes([
    { text: "出庫日時", bbox: [2050, 213, 2230, 244], confidence: 0.9 },
    { text: "07:07", bbox: [2022, 302, 2210, 333], confidence: 0.9 },
  ]);
  assert.equal(h.departTime, "07:07");
});

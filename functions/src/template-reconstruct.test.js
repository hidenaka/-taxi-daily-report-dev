// normalizeCell の No 列(int)テスト。
// 回帰防止: 貸切マーカー「貸1」が int 整形で数字だけに切り詰められ(→"1")、
// 下流 to-drive の isCharter(noText.startsWith('貸')) が外れて貸切が消える不具合。
// 休(保/㈱)に特例があるのに貸には無かったのが原因(IMG_7480 で実証)。
import { test } from "node:test";
import assert from "node:assert";
import { normalizeCell } from "./template-reconstruct.js";

test("normalizeCell int: 貸切マーカー「貸1」を保持する(数字だけに切り詰めない)", () => {
  assert.equal(normalizeCell("貸1", "int", 0.95).text, "貸1");
  assert.equal(normalizeCell("貸2", "int", 0.9).text, "貸2");
});

test("normalizeCell int: 全角「貸１」も「貸1」へ", () => {
  assert.equal(normalizeCell("貸１", "int", 0.9).text, "貸1");
});

test("normalizeCell int: 数字読み落としで「貸」のみでも貸切として残す", () => {
  assert.equal(normalizeCell("貸", "int", 0.6).text, "貸");
});

test("normalizeCell int: 通常Noは従来どおり数字のみ", () => {
  assert.equal(normalizeCell("1", "int", 0.95).text, "1");
  assert.equal(normalizeCell("12", "int", 0.95).text, "12");
  assert.equal(normalizeCell("０9", "int", 0.95).text, "9");
});

test("normalizeCell int: 休(保/㈱誤読含む)は従来どおり「休」", () => {
  assert.equal(normalizeCell("休", "int", 0.9).text, "休");
  assert.equal(normalizeCell("保", "int", 0.9).text, "休");
  assert.equal(normalizeCell("㈱", "int", 0.9).text, "休");
});

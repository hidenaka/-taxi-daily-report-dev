// 表ヘッダーの列名判定テスト。
//
// 回帰防止（2026-07-27・IMG_1523 で実証）:
// PP-OCRv5 が「乗車地」を異体字で「乘車地」と読むと、別名表の部分一致が先に
// 「乘車」→ 列名「乗車」に当たってしまい、x=1040px の 乗車地 ヘッダーが
// 「乗車」列の位置として x 軸アフィンに混ざる。1点の誤りで16列すべての境界が
// ずれ、明細全体が 2 列ぶん左にずれて復元されていた（No 欄に降車時刻が入る等）。
// 「地」で終わる語を「地」の付かない列名に当ててはいけない。
import { test } from "node:test";
import assert from "node:assert";
import { matchHeaderLabel } from "./template-reconstruct.js";

test("matchHeaderLabel: 正確な列名はそのまま当たる", () => {
  assert.equal(matchHeaderLabel("乗車地"), "乗車地");
  assert.equal(matchHeaderLabel("降車地"), "降車地");
  assert.equal(matchHeaderLabel("乗車"), "乗車");
  assert.equal(matchHeaderLabel("降車"), "降車");
  assert.equal(matchHeaderLabel("営Km"), "営Km");
});

test("matchHeaderLabel: 異体字の「乘車」は時刻列の「乗車」に当てる", () => {
  assert.equal(matchHeaderLabel("乘車"), "乗車");
});

test("matchHeaderLabel: 「地」で終わる誤読を「地」の付かない列名に当てない", () => {
  // 「乘車地」は 乗車地 の異体字誤読。時刻列の「乗車」ではない。
  assert.notEqual(matchHeaderLabel("乘車地"), "乗車");
  assert.notEqual(matchHeaderLabel("降单地"), "降車");
  assert.notEqual(matchHeaderLabel("晓車地"), "降車");
});

test("matchHeaderLabel: 列名でない語は null", () => {
  assert.equal(matchHeaderLabel("休憩時間"), null);
  assert.equal(matchHeaderLabel("大田区北馬込1"), null);
  assert.equal(matchHeaderLabel(""), null);
});

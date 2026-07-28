// 地名セルの「英字禁止」再読み取りのテスト。
//
// 背景（2026-07-29・ユーザー実機で実証）:
// 認識モデルは日本語と英字を同じ候補集合で扱うため、つぶれた漢字が英字として
// 最有力になるとそのまま出る（馬込→J、佃→a、清澄→ie）。地名にアルファベットは
// 絶対に出ないので、地名らしいセルに英字が混ざったときは、英字の候補を封じて
// （復号時に英字クラスを選ばない）そのセルだけ読み直す。
import { test } from "node:test";
import assert from "node:assert";
import {
  bannedLatinIndices,
  maskedCtcDecode,
  needsLatinRescue,
} from "./latin-ban.js";

test("bannedLatinIndices: 半角/全角の英字だけを禁止し、数字・かな・漢字は残す", () => {
  const dict = ["", "北", "J", "2", "a", "ｅ", "Ｚ", "込", "ア", "・"];
  const banned = bannedLatinIndices(dict);
  assert.deepEqual([...banned].sort((p, q) => p - q), [2, 4, 5, 6]);
});

test("maskedCtcDecode: 英字が最有力でも、禁止して次点の漢字を選ぶ", () => {
  // dict: [blank, 北, J, 込]。t=0 は「北」が最有力、t=1 は「J」が最有力で「込」が次点。
  const dict = ["", "北", "J", "込"];
  const numClasses = 4;
  const logits = Float32Array.from([
    /* t0 */ 0.01, 0.90, 0.05, 0.04,
    /* t1 */ 0.01, 0.04, 0.80, 0.15,
  ]);
  const banned = bannedLatinIndices(dict);
  const plain = maskedCtcDecode(logits, 2, numClasses, dict, new Set());
  const masked = maskedCtcDecode(logits, 2, numClasses, dict, banned);
  assert.equal(plain.text, "北J", "禁止なしでは英字が出る（前提確認）");
  assert.equal(masked.text, "北込", "禁止すると次点の漢字が選ばれる");
});

test("maskedCtcDecode: blank と連続文字の CTC 規則は禁止時も維持される", () => {
  const dict = ["", "馬", "b"];
  // 馬 馬(重複) blank 馬 → 「馬馬」
  const logits = Float32Array.from([
    0.1, 0.8, 0.1,
    0.1, 0.8, 0.1,
    0.9, 0.05, 0.05,
    0.1, 0.8, 0.1,
  ]);
  const r = maskedCtcDecode(logits, 4, 3, dict, bannedLatinIndices(dict));
  assert.equal(r.text, "馬馬");
});

test("needsLatinRescue: 地名らしいセルに英字が混ざったときだけ発動する", () => {
  assert.equal(needsLatinRescue("大田区北J2"), true);
  assert.equal(needsLatinRescue("中央区a2"), true);
  assert.equal(needsLatinRescue("江東区ie"), true);
  assert.equal(needsLatinRescue("江東区ｉｅ"), true, "全角英字も対象");
  // 発動してはいけないもの
  assert.equal(needsLatinRescue("大田区北馬込2"), false, "正常な地名");
  assert.equal(needsLatinRescue("ネット決済 ETC"), false, "備考の英字は正当");
  assert.equal(needsLatinRescue("営Km"), false, "見出しの英字は正当");
  assert.equal(needsLatinRescue("6/2008:25"), false, "日時セル");
  assert.equal(needsLatinRescue(""), false);
});

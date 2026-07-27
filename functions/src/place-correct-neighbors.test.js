// 東京近郊（千葉・神奈川・埼玉）の町名補正テスト。
//
// 回帰防止（2026-07-27・IMG_1556 で実証）:
// 町名辞書が東京都の市区町村ぶんしか無く、都外の地名は町名を補正できなかった。
// 2026/06/18 の明細では「市川市欠真間1」が「市川市次真間1」と誤読されたまま
// 出ていた（区市町村名は辞書にあるので lowConfidence にはなるが直らない）。
// 営業範囲は都県境をまたぐので、隣接県の町名も辞書に持つ。
import { test } from "node:test";
import assert from "node:assert";
import { correctPlace } from "./place-correct.js";
import { createRequire } from "node:module";

const GAZETTEER = createRequire(import.meta.url)("../data/tokyo-chome.json");

const fix = (s) => correctPlace(s, GAZETTEER);

test("千葉県: 市川市の町名を補正する（欠→次 の誤読）", () => {
  const r = fix("市川市次真間1");
  assert.equal(r.text, "市川市欠真間1");
  assert.equal(r.corrected, true);
  assert.equal(r.lowConfidence, false);
});

test("千葉県: 正しく読めている市川市の地名は変えない", () => {
  const r = fix("市川市湊新田2");
  assert.equal(r.text, "市川市湊新田2");
  assert.equal(r.lowConfidence, false);
});

test("神奈川県: 政令市の区つき地名も補正できる", () => {
  // 川崎市中原区新丸子東 / 川崎市高津区末長 は実際の明細に出る地名
  assert.equal(fix("川崎市中原区新丸子東3").text, "川崎市中原区新丸子東3");
  assert.equal(fix("川崎市高津区末長1").text, "川崎市高津区末長1");
  assert.equal(fix("横浜市中区本牧和田").text, "横浜市中区本牧和田");
});

test("埼玉県: 都県境の市の町名も辞書にある", () => {
  assert.equal(fix("川口市栄町3").text, "川口市栄町3");
});

test("東京の地名は従来どおり補正される（退行防止）", () => {
  assert.equal(fix("洪谷区神宮前1").text, "渋谷区神宮前1");
  assert.equal(fix("江東区有明2").text, "江東区有明2");
  assert.equal(fix("大田区羽田空港3").text, "大田区羽田空港3");
  assert.equal(fix("世田谷区深沢7").text, "世田谷区深沢7");
});

test("関東圏外の地名は原文のまま低信頼で返す（レビュー対象になる）", () => {
  const r = fix("札幌市中央区北1条西3");
  assert.equal(r.text, "札幌市中央区北1条西3");
  assert.equal(r.corrected, false);
  assert.equal(r.lowConfidence, true);
});

// 地名補正の同点候補の扱いのテスト。
//
// 背景（2026-07-27）:
// 辞書へのファジーマッチは、最も近い候補が同点で複数あっても黙って1つを選び、
// しかも「どれが選ばれるか」は辞書の並び順で決まっていた（＝辞書を更新すると
// 結果が変わる）。さらに当たったか外したかが利用者に分からなかった。
// 実害の例:
//   「新宿区坂町」… 明細の印字は正しいが辞書の正式名は「四谷坂町」。1文字差の
//                  候補(中町/榎町/…)が多数あり、その1つへ黙って書き換えていた。
//   「日区自由が丘1」… 区名が1文字落ちた誤読。dist=1 の区が20以上ある。
// そこで
//   (a) OCR の誤りとして説明が付く候補（同字数＝置換 / 部分列＝脱字）を優先する
//   (b) それでも絞れないときは従来どおり先頭候補を採るが、低信頼の印を付けて
//       レビュー対象にする（黙って確定させない）
import { test } from "node:test";
import assert from "node:assert";
import { correctPlace } from "./place-correct.js";
import { createRequire } from "node:module";

const GAZETTEER = createRequire(import.meta.url)("../data/tokyo-chome.json");
const fix = (s) => correctPlace(s, GAZETTEER);

test("置換で一意に説明できる候補を選ぶ（同字数を優先）", () => {
  // 「次真間」… 距離1の候補は 欠真間(置換・同字数) と 真間(脱字)。前者を採る。
  const r = fix("市川市次真間1");
  assert.equal(r.text, "市川市欠真間1");
  assert.equal(r.lowConfidence, false, "説明が付くので低信頼にしない");
});

test("脱字で一意に説明できる候補を選ぶ（部分列を優先）", () => {
  // 「大山」… 距離1の候補は 大岡山/大橋/東山。原文が部分列なのは 大岡山 だけ。
  const r = fix("目黒区大山2");
  assert.equal(r.text, "目黒区大岡山2");
  assert.equal(r.lowConfidence, false);
});

test("どちらでも絞れないときは補正しつつ低信頼の印を付ける", () => {
  // 「坂町」は辞書に無く（正式名は四谷坂町）、1文字差の候補が多数並ぶ。
  const r = fix("新宿区坂町");
  assert.equal(r.lowConfidence, true, "当てずっぽうなのでレビュー対象にする");
});

test("区名が絞れないときも低信頼の印を付ける", () => {
  // 「日区」は 北区/港区/西区… と1文字差で並ぶ。
  const r = fix("日区自由が丘1");
  assert.equal(r.lowConfidence, true);
});

test("完全一致は同名候補があってもそのまま・高信頼", () => {
  const a = fix("新宿区中町");
  assert.equal(a.text, "新宿区中町");
  assert.equal(a.lowConfidence, false);
  const b = fix("目黒区自由が丘1");
  assert.equal(b.text, "目黒区自由が丘1");
  assert.equal(b.lowConfidence, false);
});

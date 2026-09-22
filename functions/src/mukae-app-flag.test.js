// 迎 列の「ア」(アプリ配車) を落とさないための回帰テスト。
// 以前は flag 列の正規化が「迎らしき字なら 迎、それ以外は空」だったため、
// 印字された「ア」が OCR で正しく読めていても消えていた(2026-09-17 本人指摘)。
import { test } from "node:test";
import assert from "node:assert";
import { normalizeCell } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";

test("normalizeCell(flag): ア はそのまま ア で残る", () => {
  assert.strictEqual(normalizeCell("ア", "flag", 0.98).text, "ア");
  assert.strictEqual(normalizeCell("ァ", "flag", 0.9).text, "ア");   // 小書き誤読
});

test("normalizeCell(flag): 迎 系はこれまでどおり 迎、空は空", () => {
  assert.strictEqual(normalizeCell("迎", "flag", 1).text, "迎");
  assert.strictEqual(normalizeCell("週", "flag", 1).text, "迎");
  assert.strictEqual(normalizeCell("", "flag", 1).text, "");
});

test("rowsToDrive: 迎=ア の行は pickupKind='ア'・isPickup=true(アも迎車にカウント)", () => {
  const row = {
    No: "2", 乗車: "8:45", 降車: "9:15", 迎: "ア",
    乗車地: "大田区上池台1", 降車地: "渋谷区渋谷3", 営Km: "8.6", 合計: "5,000",
  };
  const { trips } = rowsToDrive([row]);
  assert.strictEqual(trips.length, 1);
  assert.strictEqual(trips[0].pickupKind, "ア");
  assert.strictEqual(trips[0].isPickup, true);
});

test("rowsToDrive: 迎=迎 の行は従来どおり pickupKind='迎'・isPickup=true", () => {
  const row = {
    No: "3", 乗車: "9:20", 降車: "9:23", 迎: "迎",
    乗車地: "渋谷区代官山町", 降車地: "目黒区青葉台1", 営Km: "0.7", 合計: "1,000",
  };
  const { trips } = rowsToDrive([row]);
  assert.strictEqual(trips[0].pickupKind, "迎");
  assert.strictEqual(trips[0].isPickup, true);
});

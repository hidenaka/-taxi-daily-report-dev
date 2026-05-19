// functions/src/header-ocr.integration.test.js
// extractHeader の統合テスト。実画像でOCRを実行するため低速（数十秒）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHeader } from "./header-ocr.js";

const SAMPLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "ocr-spike", "test-images", "2026-05-10.png"
);

test("実画像 2026-05-10.png からヘッダー4項目を読み取る", { timeout: 180000 }, async () => {
  const buf = fs.readFileSync(SAMPLE);
  const h = await extractHeader(buf);
  assert.equal(h.date, "2026-05-10");
  assert.equal(h.departTime, "07:07");
  assert.equal(h.returnTime, "00:39");
  assert.equal(h.totalKm, 309);
});

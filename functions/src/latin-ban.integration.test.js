// 英字禁止の再読み取りを、実モデル（PP-OCRv5）で通す結線テスト。
//
// test-fixtures/degraded-place-cell.png は「大田区北馬込1丁目」のセルを
// 20% まで縮小した実画像。素の認識では「大田区北周必1T目」と英字 T が
// 混ざることを実験で確認済み（丁 が T に化ける）。英字禁止の復号では
// 同じ推論結果から「1丁目」と正しい漢字が選ばれる。
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "ppu-ocv";
import { getService, getRawDictionary } from "./ocr-engine.js";
import { rescueLatinPlaceBoxes } from "./latin-ban.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");

test("劣化セルの英字誤読を、英字禁止の読み直しで漢字に戻す", async () => {
  const img = await loadImage(fs.readFileSync(path.join(FIXTURES, "degraded-place-cell.png")));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);

  // このセルが素の認識で「大田区北周必1T目」（英字入り）になる想定の box
  const boxes = [{ text: "大田区北周必1T目", bbox: [0, 0, img.width, img.height], confidence: 0.9 }];
  const changed = await rescueLatinPlaceBoxes(
    boxes, canvas, await getService(), getRawDictionary(), createCanvas,
  );

  assert.equal(changed.length, 1, "読み直しが実行される");
  assert.ok(!/[A-Za-zＡ-Ｚａ-ｚ]/.test(boxes[0].text), "英字が消えている: " + boxes[0].text);
  assert.ok(/[一-鿿]/.test(boxes[0].text), "漢字が入っている");
  assert.ok(boxes[0].confidence <= 0.5, "確定させず低信頼（黄色）のまま");
});

test("英字の無い地名・備考の英字は読み直さない（既存挙動を守る）", async () => {
  const canvas = createCanvas(40, 12);
  const boxes = [
    { text: "大田区北馬込1丁目", bbox: [0, 0, 40, 12], confidence: 0.95 },
    { text: "ネット決済 ETC", bbox: [0, 0, 40, 12], confidence: 0.9 },
  ];
  const changed = await rescueLatinPlaceBoxes(
    boxes, canvas, await getService(), getRawDictionary(), createCanvas,
  );
  assert.equal(changed.length, 0);
  assert.equal(boxes[0].text, "大田区北馬込1丁目");
  assert.equal(boxes[0].confidence, 0.95, "confidence も触らない");
  assert.equal(boxes[1].text, "ネット決済 ETC");
});

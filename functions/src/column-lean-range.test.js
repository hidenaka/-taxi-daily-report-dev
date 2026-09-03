// 列の傾き(column lean)が大きい写真でも、値が隣の列へ落ちないこと。
//
// 背景: 印刷フォームは前処理後にシア変形し、縦の列罫線が y につれて右へドリフトする。
// reconstructRows はその傾きを探索して x を補正するが、探索範囲が ±0.07 しかなく、
// それを超える写真では補正が頭打ちになって列がずれていた。
//
// 2026-09-03 の明細（実写真）で実測した傾きは 0.085 で、範囲外だった。
// 壊れ方: 営Km の「7.5」が隣の「男」列へ落ち、int 整形されて「75」になる。
//         同様に 合計 が 料金 へ、料金 が 現収 へと玉突きでずれる。
//         結果、運賃計が ¥88,200 → ¥24,908 になっていた。
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructRows } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");
const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "2026-09-03-column-lean.json"), "utf8"));
const drive = () => {
  const { rows } = reconstructRows({ boxes: data.boxes });
  return { rows, ...rowsToDrive(rows) };
};

test("傾きの大きい写真でも 営Km が「男」列へ落ちない", () => {
  const { trips } = drive();
  // 用紙の実測値（先頭10件の営Km）
  const expected = [11.3, 2.8, 7.5, 4.4, 3.7, 6.3, 1.1, 2.8, 4.1, 2.2];
  assert.deepEqual(trips.slice(0, 10).map((t) => t.km), expected);
});

test("「男」列に km の値が紛れ込まない（人数は1桁）", () => {
  const { rows } = drive();
  for (const r of rows) {
    for (const col of ["男", "女"]) {
      const v = String(r[col] ?? "").trim();
      if (!v) continue;
      assert.ok(/^[0-9]$/.test(v), `${col}列に 1桁でない値 "${v}"（km が落ちてきている疑い）`);
    }
  }
});

test("金額が 合計→料金→現収 へ玉突きでずれない", () => {
  const { trips } = drive();
  // 用紙の実測値（先頭10件の運賃）
  const expected = [5700, 2400, 6000, 2900, 2600, 4100, 1200, 2000, 2700, 1800];
  assert.deepEqual(trips.slice(0, 10).map((t) => t.amount), expected);
});

test("「料金」列はサービス料金なので 500 以外が入らない", () => {
  const { rows } = drive();
  for (const r of rows) {
    const v = String(r["料金"] ?? "").trim();
    if (!v) continue;
    assert.ok(v === "500", `料金列に "${v}"（合計が押し出されている疑い）`);
  }
});

test("運賃の合計が用紙の水準まで戻る", () => {
  const { trips } = drive();
  const sum = trips.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  // 用紙の運賃は 88,200。末尾数行は別の原因（行の傾き）でまだ落ちるため、
  // ここでは「列ずれが直った水準」をゲートにする。壊れていた頃は 24,908 だった。
  assert.ok(sum >= 80000, `運賃計 ¥${sum.toLocaleString()} が低すぎる（列ずれの疑い）`);
});

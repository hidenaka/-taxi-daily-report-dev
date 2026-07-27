// 見出し行が読めない写真でも明細表を特定できることのテスト。
//
// 背景（2026-07-27・IMG_1555 で実証）:
// 表の位置は「見出し行の列名（No/乗車/降車/…）」から決めていた。見出しの文字は
// 本文より小さく、写真がぼけると真っ先に潰れる。LINE 経由で圧縮された写真
// （約164万画素）では見出しの認識が 0 個になり、本文は 82% が高信頼で読めているのに
// 1件も取り出せなかった。
// そこで見出しが取れないときは、本文の「どの列に何が入るか」（時刻/地名/小数/金額/備考）
// で枠を当てるフォールバックを用意した。
//
// 注: 幾何だけ（列の隙間・表の左右端）では決まらない。OCR の box が列境界をまたぐため。
//     また時刻3列・金額5列・地名2列は1列ずらしても型が合うので、種類ごとに重みを
//     均さないと1列ずれた解に落ちる（実際に落ちたので重み付けを入れた）。
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructRows, fitGridFromBody } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

test("見出しが読めない写真でも明細を復元する", () => {
  const data = load("no-header-blurry.json");
  const { trips, rests } = rowsToDrive(reconstructRows({ boxes: data.boxes }).rows);

  // 用紙の実測値: 営業 26 件。行そのものは全て取れる。
  // No 列は本文よりさらに小さく、この画質では一部読めない（11/12 が空・13 を 12 と誤読）。
  // 行と中身が正しく並んでいることが本質なので、番号は先頭・末尾と件数で確認する。
  assert.equal(trips.length, 26, "営業件数");
  assert.equal(trips[0].no, 1);
  assert.equal(trips[25].no, 26);
  assert.ok(trips.filter((t) => Number.isFinite(t.no)).length >= 22, "大半の No は読める");

  // 列が正しい位置に入っていること（金額・km・時刻が行と対応している）
  assert.equal(trips[1].boardTime, "9:10");
  assert.equal(trips[1].alightPlace, "大田区羽田空港3");
  assert.equal(trips[1].km, 25.5);
  assert.equal(trips[1].amount, 11570);
  assert.equal(trips[18].amount, 12020);      // 19件目 港区高輪2→川崎市高津区新作5
  assert.equal(trips[25].alightPlace, "江東区富岡2"); // 最終 26 件目

  // ETC明細（入口/出口/料金）を営業に数えていないこと。
  // この写真では「ETC明細」「預り金」の見出しも読めないため、本文の帯の下で切っている。
  assert.ok(trips.every((t) => /[区市]/.test(t.boardPlace)), "ETC明細の行が混ざっていない");
  assert.equal(rests.length, 4, "休憩4回（用紙どおり。「休」の字は 体/试/仕 と誤読されるが行の形で拾う）");
  assert.deepEqual(rests.map((r) => r.startTime), ["13:44", "20:45", "23:48", "2:07"]);
});

test("fitGridFromBody: 明細らしくない box 群では枠を作らない（誤検出しない）", () => {
  assert.equal(fitGridFromBody([]), null);
  // 地名が少ない＝上部サマリーだけ、のようなケース
  const few = Array.from({ length: 5 }, (_, i) => ({
    text: "大田区北馬込1", bbox: [100, 100 + i * 50, 400, 140 + i * 50], confidence: 0.9,
  }));
  assert.equal(fitGridFromBody(few), null);
});

test("見出しが読める写真ではフォールバックを使わない（既存の挙動を変えない）", () => {
  const data = load("2026-06-18-punch-hole.json");
  const res = reconstructRows({ boxes: data.boxes });
  assert.equal(res._loc.inliers > 0, true, "ヘッダー由来のアフィンが使われている");
});

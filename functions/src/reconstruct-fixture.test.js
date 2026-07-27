// 実写真の OCR ボックスを固定入力にした復元パイプラインの回帰テスト。
//
// test-fixtures/*.json は実際の営業明細写真を preprocess + PP-OCRv5 に通した
// 検出ボックスをそのまま保存したもの（OCR は決定論的なので、ここから先の
// reconstructRows / rowsToDrive は毎回同じ結果になる）。モデルを積まずに
// 「行の対応づけ」の退行だけを高速に検出できる。
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructRows } from "./template-reconstruct.js";
import { rowsToDrive } from "./to-drive.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");

function driveOf(name) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
  const { rows } = reconstructRows({ boxes: data.boxes });
  return rowsToDrive(rows);
}

// 乗車時刻(START列) と 金額(END列) の組。両者の対応づけが1行でもズレると壊れる。
// 文字認識の誤り（地名の異体字など）には影響されない指標なのでゲートに向く。
const pairs = (trips) => trips.map((t) => `${t.no ?? "-"} ${t.boardTime} ${t.amount}`);

test("2026/06/18 明細（パンチ穴で No.11/12 が潰れた写真）を正しく読む", () => {
  const { trips, rests } = driveOf("2026-06-18-punch-hole.json");

  // 用紙の実測値: 営業 28 件・休憩 5 回
  assert.equal(trips.length, 28, "営業件数");
  assert.equal(rests.length, 5, "休憩回数");

  // No は 1..28 の連番（穴で読めない 11/12、誤読された 4 も補完される）
  assert.deepEqual(trips.map((t) => t.no), Array.from({ length: 28 }, (_, i) => i + 1));

  // 乗車時刻と金額の対応（用紙の営業明細そのまま）
  assert.deepEqual(pairs(trips), [
    "1 8:46 0",       // 0.0km 500円 = キャンセル扱いで 0
    "2 9:00 2000",
    "3 9:16 2600",
    "4 9:38 4500",    // No が "A" と誤読された行
    "5 10:07 0",
    "6 10:13 0",
    "7 10:38 5700",
    "8 11:25 2800",
    "9 11:56 9680",
    "10 14:03 9000",
    "11 15:05 6800",  // パンチ穴で No が消えた行
    "12 16:13 6900",  // パンチ穴で No が消えた行
    "13 17:07 3700",
    "14 17:49 6400",
    "15 19:51 3000",
    "16 20:39 2400",
    "17 21:07 1600",
    "18 21:32 8200",
    "19 22:18 1800",
    "20 22:31 1200",
    "21 22:58 1700",
    "22 23:11 3100",
    "23 23:48 1600",
    "24 0:33 1100",
    "25 1:03 1900",
    "26 1:43 3500",
    "27 2:10 3700",
    "28 2:34 9300",
  ]);

  // 報告された症状そのもの: 28件目の降車地が26件目のものになっていた
  assert.equal(trips[27].boardPlace, "中央区築地3");
  assert.equal(trips[27].alightPlace, "世田谷区深沢7");
  assert.equal(trips[25].alightPlace, "中央区日本橋大伝馬町");

  // 都外（千葉県）の地名も辞書補正が効く。「欠真間」を「次真間」と誤読していた。
  assert.equal(rests[1].place, "市川市欠真間1");
});

test("斜め・小さく写った明細（列が2列ぶんずれていた写真）を正しく読む", () => {
  // ヘッダー「乗車地」を "乘車地" と誤読 → 別名の部分一致で列名「乗車」に化け、
  // その1点が x 軸アフィンを壊して16列すべてが2列ぶんずれていた写真。
  const { trips, rests } = driveOf("skewed-small-frame.json");

  // 用紙の実測値: 営業 34 件・休憩 10 回（回送 2 行は営業に数えない）
  assert.equal(trips.length, 34, "営業件数");
  assert.equal(rests.length, 10, "休憩回数");
  assert.deepEqual(trips.map((t) => t.no), Array.from({ length: 34 }, (_, i) => i + 1));

  // 列が正しい位置に入っていること（ずれていた頃は No 欄に降車時刻が入っていた）
  assert.equal(trips[0].boardTime, "8:21");
  assert.equal(trips[0].alightTime, "8:41");
  assert.equal(trips[0].alightPlace, "大田区池上6");
  assert.equal(trips[0].amount, 2800);
  assert.equal(trips[27].amount, 14490);   // 28件目 小金井市桜町5 27.7km
  assert.equal(trips[33].alightPlace, "目黒区大岡山2"); // 最終 34 件目
});

test("貸切と休憩を含む明細（従来から読めていた写真）の結果を維持する", () => {
  const { trips, rests } = driveOf("charter-and-rests.json");

  assert.equal(trips.length, 16, "営業件数");
  assert.equal(rests.length, 8, "休憩回数");
  assert.deepEqual(pairs(trips), [
    "1 7:07 2800",
    "2 7:38 11390",
    "3 8:17 3500",
    "4 8:49 2900",
    "5 9:21 4400",
    "6 9:57 0",
    "7 10:05 3400",
    "8 10:35 28580",
    "9 13:08 7600",
    "10 14:26 10400",
    "11 15:35 9400",
    "12 16:09 3800",
    "13 16:42 0",
    "14 16:49 3600",
    "1 17:53 10000",  // 貸切行（No 欄が「貸1」）
    "15 18:50 7600",
  ]);
  assert.equal(trips[14].isCharter, true, "貸切フラグ");
});

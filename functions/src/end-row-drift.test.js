// END 列（降車地・営Km・金額）の対応づけが、写真の遠近歪みでずれないこと。
//
// 背景: 明細1行は「START列(No〜乗車地)」と「END列(降車地〜備考)」に分かれて印字され、
// END は START より一定量だけ上に出る。assignEndRows はその一定量 delta を1つ探して
// 全行に当てていた。
//
// 斜めから撮った写真は遠近で上と下の行間隔が変わるため、delta も上下で変わる。
// 単一の delta では多数派の行にしか合わず、合わない行は許容(0.45ピッチ)を超えて
// 未割り当てになり、その前後で対応が1つずれる。
// 2026-09-03 の原本(5712x4284)で実際に起きていた:
//   行1→未割当 / 行2→END[0] / 行3→END[1] / 行4→未割当 / 行5→END[4]
//   （END[2] と END[3] が飛ばされ、降車地と金額が1行ずれていた）
import { test } from "node:test";
import assert from "node:assert";
import { assignEndRows } from "./template-reconstruct.js";

const PITCH = 46;
const trips = (ys) => ys.map((y) => ({ y, kind: "trip" }));

test("delta が一定なら従来どおり素直に対応づく", () => {
  const starts = trips([100, 146, 192, 238, 284]);
  const endYs = starts.map((s) => s.y - 30);
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, [0, 1, 2, 3, 4]);
});

test("上下で delta が変わっても（遠近歪み）全行に対応づく", () => {
  // 上の行は END が 22px 上、下へ行くほど広がって 46px 上になる写真
  const starts = trips([100, 146, 192, 238, 284, 330, 376, 422, 468, 514]);
  const endYs = starts.map((s, i) => s.y - (22 + i * 2.7));
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "遠近で delta が変わる写真でも END が1行ずれてはいけない");
});

test("休憩行は END を持たないので飛ばされる", () => {
  const starts = [
    { y: 100, kind: "trip" }, { y: 146, kind: "rest" },
    { y: 192, kind: "trip" }, { y: 238, kind: "trip" },
  ];
  // 休憩以外の3行ぶんの END（それぞれ 30px 上）
  const endYs = [100 - 30, 192 - 30, 238 - 30];
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, [0, 2, 3], "END は休憩行を飛ばしてトリップ行に付く");
});

// 注: 「END が START より少ない」だけのケースは意図的に置いていない。
// 全行が trip だと、END をどの行に寄せても残差ゼロの Δ が存在するため、
// 正解が原理的に決まらない（実データでは足りない分は必ず休憩行で、
// それは上の「休憩行は END を持たない」でカバーされる）。

test("ずれが大きすぎる END は付けない", () => {
  const starts = trips([100, 146, 192]);
  const endYs = [100 - 30, 146 - 30, 192 - 30, 900]; // 最後は表の外
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map.slice(0, 3), [0, 1, 2]);
  assert.equal(map[3], -1, "かけ離れた END は未割り当て");
});

// --- 実写真（原本）での回帰 ---
// 2026-09-03 の日報を iPhone で斜めから撮った原本(5712x4284)。
// 遠近で END と START の間隔が表の上下で 1.04 行ぶん変わり、Δ 単一では
// 行1・行4 が未割り当てになって降車地と金額が1行ずれていた。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructRows } from "./template-reconstruct.js";
import { rowsToDrive, isRevenueTrip } from "./to-drive.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures");
const origDrive = () => {
  const d = JSON.parse(fs.readFileSync(path.join(FIX, "2026-09-03-perspective-orig.json"), "utf8"));
  const { rows } = reconstructRows({ boxes: d.boxes });
  return rowsToDrive(rows);
};

test("原本(斜め撮影)の先頭4行が、用紙どおりの降車地・km・金額になる", () => {
  const { trips } = origDrive();
  const head = trips.slice(0, 4).map((t) => `${t.no} ${t.boardPlace}→${t.alightPlace} ${t.km} ${t.amount}`);
  assert.deepEqual(head, [
    "1 品川区小山3→千代田区麹町5 11.3 5700",
    "2 港区赤坂4→新宿区市谷田町2 2.8 2400",
    "3 新宿区東五軒町→新宿区東五軒町 7.5 6000",
    "4 新宿区袋町→港区南青山1 4.4 2900",
  ]);
});

test("原本は 31 行すべて営業として読める", () => {
  const { trips, rests } = origDrive();
  assert.equal(trips.filter(isRevenueTrip).length, 31, "営業件数");
  assert.equal(rests.length, 7, "休憩回数");
});

test("原本の金額合計が用紙の総営業収入に一致する", () => {
  const { trips } = origDrive();
  const sum = trips.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  // 用紙: 総営業収入 103,700。うち No.11 は 0.0km/500円 でキャンセル判定され 0 になる。
  assert.equal(sum + 500, 103700);
});

// END 物理行 → エントリ（START 物理行）対応づけのテスト。
//
// 回帰防止（2026-07-27・IMG_1556 = 2026/06/18 明細で実証）:
// 旧実装は「No が数字で読めた START 行」と END 行を上から順に 1:1 で対応させていた。
// 明細用紙にパンチ穴が開いていると No.11/12 のセルが潰れて数字が読めず、
//   (a) その2行は END（降車地・km・料金）が付かないまま営業行から落ち、
//   (b) それ以降の全 END が2つ手前のエントリにズレる
// （実例: 28件目「中央区築地3→世田谷区深沢7」の降車地が26件目の
//   「中央区日本橋大伝馬町」になった）。
// 対応づけを No に依存させず y 幾何で行うことで、No が読めない行があっても
// ズレないことを検証する。
import { test } from "node:test";
import assert from "node:assert";
import { assignEndRows } from "./template-reconstruct.js";

const PITCH = 50;

// starts を簡潔に書くためのヘルパ。kinds は 'T'(trip) / 'R'(rest) / 'U'(unknown)。
function makeStarts(kinds, y0 = 1000, pitch = PITCH) {
  return kinds.split("").map((k, i) => ({
    y: y0 + i * pitch,
    kind: k === "T" ? "trip" : k === "R" ? "rest" : "unknown",
  }));
}

test("assignEndRows: No が読めない行(パンチ穴)があっても END は正しい行に付く", () => {
  //  0:T 1:T 2:U(穴で No 読めず) 3:U(穴) 4:T 5:R(休) 6:T
  const starts = makeStarts("TTUUTRT");
  // 休 以外の全行に END がある。END は START より 1.2 ピッチ上に印字される。
  const tripIdx = [0, 1, 2, 3, 4, 6];
  const endYs = tripIdx.map((i) => starts[i].y - PITCH * 1.2);
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, tripIdx);
});

test("assignEndRows: 休 行には END を割り当てない", () => {
  const starts = makeStarts("TRTRT");
  const tripIdx = [0, 2, 4];
  const endYs = tripIdx.map((i) => starts[i].y - PITCH * 1.1);
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, tripIdx);
});

test("assignEndRows: END が途中で1つ欠落しても後続はズレない", () => {
  const starts = makeStarts("TTTTTT");
  // index 2 の END を OCR が落としたケース
  const tripIdx = [0, 1, 3, 4, 5];
  const endYs = tripIdx.map((i) => starts[i].y - PITCH * 0.9);
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, tripIdx);
});

test("assignEndRows: END が START と同じ高さに印字される様式でも正しく付く", () => {
  // オフセットは画像ごとに違う（実測 -1.2〜+0.2 ピッチ）。0 でも成立すること。
  const starts = makeStarts("TTRTT");
  const tripIdx = [0, 1, 3, 4];
  const endYs = tripIdx.map((i) => starts[i].y + PITCH * 0.05);
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, tripIdx);
});

test("assignEndRows: 系統オフセットが行によって少しドリフトしても追従する", () => {
  const starts = makeStarts("TTTTTTTTTT");
  const tripIdx = starts.map((_, i) => i);
  // -1.0 ピッチから -1.3 ピッチへ徐々にずれる（印字ヘッドのドリフト実測相当）
  const endYs = tripIdx.map((i) => starts[i].y - PITCH * (1.0 + 0.03 * i));
  const { map } = assignEndRows(starts, endYs, PITCH);
  assert.deepEqual(map, tripIdx);
});

test("assignEndRows: START 行も END 行も無いときは空を返す", () => {
  assert.deepEqual(assignEndRows([], [], PITCH).map, []);
  assert.deepEqual(assignEndRows(makeStarts("TT"), [], PITCH).map, []);
});

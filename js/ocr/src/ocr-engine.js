// js/ocr/src/ocr-engine.js
// PP-OCR（ppu-paddle-ocr web版）のラッパ。検出・認識ともに基盤 PP-OCRv5。
// 設定は ocr-spike/run-paddle-v5.mjs（Node検証済み）と同一。
// 注: ppu-paddle-ocr の web ビルドは画像処理に canvas-native を使う（OpenCV不要）。
//
// 帯分割: iOS Safari は画像全体を一度に推論するとメモリ不足でクラッシュする
// （ページ表示・モデル読込は通り、svc.recognize の推論中に落ちる）。
// 画像を縦の帯に分割し1帯ずつ推論することで、推論時のメモリの山を下げる。
import { PaddleOcrService } from "ppu-paddle-ocr/web";

// 認識は基盤 PP-OCRv5 mobile（多言語＝日本語＋数字を高精度に読む）。検出もv5。
// v5は日本語を簡体字字形で出すことがあるため、grid-reconstruct 側で
// kanji-normalize による日本語常用漢字への正規化を行う。
const MODEL_BASE = "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";
const DICT_BASE = "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

let service = null;

// ── 推論テンソルの解放（iOS Safari メモリリーク対策） ──────────
// ppu-paddle-ocr は session.run の出力テンソルを dispose しない。per-box 認識は
// 1帯あたり数十回 inference を回すため、出力テンソルが抱える onnxruntime-web の
// WASMメモリが解放されず積み上がり、複数帯の処理でiOS Safariのメモリ上限を
// 超える（「1帯目は成功・2帯目で落ちる」症状の原因）。
// recognitor.runInference をラップし、次の inference 直前に前回の出力を dispose
// することで、未解放の出力テンソルを常に1個以下に抑える。
function patchTensorDisposal(servicePart) {
  if (!servicePart || typeof servicePart.runInference !== "function") return;
  const original = servicePart.runInference.bind(servicePart);
  let previous = null;
  servicePart.runInference = async (...args) => {
    if (previous && typeof previous.dispose === "function") {
      try { previous.dispose(); } catch (_) {}
    }
    previous = null;
    const out = await original(...args);
    // recognition は出力テンソルを返す（dispose可）。detection は .data を返すため対象外。
    if (out && typeof out.dispose === "function") previous = out;
    return out;
  };
}

/**
 * PP-OCRサービスを初期化（モデルをfetchしロード）。初回は時間がかかる。
 * 2回目以降は同一インスタンスを返す。
 */
export async function initOcr() {
  if (service) return service;
  const svc = new PaddleOcrService({
    model: {
      detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
      recognition: `${MODEL_BASE}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
      charactersDictionary: `${DICT_BASE}/recognition/ppocrv5_dict.txt`,
    },
    // 明細表の小さい数字を拾うため検出解像度を上げる（Phase 0/1A検証で確定）。
    detection: { maxSideLength: 1600, minimumAreaThreshold: 20 },
  });
  await svc.initialize();
  // 出力テンソルの解放漏れ対策（複数帯処理でのWASMメモリ蓄積を防ぐ）。
  patchTensorDisposal(svc.recognitor);
  service = svc;
  return service;
}

// ── 帯分割パラメータ ─────────────────────────────────────────
const STRIP_HEIGHT = 1200; // 1帯の高さ目安（px）。小さいほど推論時メモリは下がるが遅くなる
const STRIP_OVERLAP = 320; // 帯どうしの重なり（px）。最大行高より大きく取り、
//                            どの行も必ずいずれか1帯の内部に完全に収まるようにする
const SINGLE_STRIP_MAX = 2200; // この高さ以下なら分割しない（従来どおり1回で推論）
const EDGE_MARGIN = 8; // 帯の切れ目に接する box の判定マージン（px）
const DEDUPE_IOU = 0.5; // この重なり率を超える box 同士は同一とみなす

// 画像の高さから帯の {y0,y1} リストを作る。
function planStrips(height) {
  if (height <= SINGLE_STRIP_MAX) return [{ y0: 0, y1: height }];
  const advance = STRIP_HEIGHT - STRIP_OVERLAP;
  const strips = [];
  for (let y0 = 0; y0 < height; y0 += advance) {
    const y1 = Math.min(height, y0 + STRIP_HEIGHT);
    strips.push({ y0, y1 });
    if (y1 >= height) break;
  }
  return strips;
}

// canvas の [y0,y1) の横帯を切り出した新しい canvas を返す。
function cropStrip(canvas, y0, y1) {
  const h = y1 - y0;
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = h;
  c.getContext("2d").drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
  return c;
}

// 2つのbboxの IoU（重なり率）。
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// 帯の重なりで二重に検出された box を、確信度の高い方を残して除去する。
function dedupeBoxes(boxes) {
  const sorted = boxes.slice().sort((p, q) => q.confidence - p.confidence);
  const kept = [];
  for (const b of sorted) {
    if (kept.some((k) => iou(k, b) > DEDUPE_IOU)) continue;
    kept.push(b);
  }
  return kept;
}

/**
 * 前処理済みcanvasをOCRする。帯分割し1帯ずつ推論する。
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {(stage:string, detail?:string)=>void} [onStage] "model-load"/"recognize" を通知する。
 *   "recognize" は帯ごとに detail="2/4" 形式の進捗を伴う。
 * @returns {Promise<{text:string, boxes:Array<{text:string,bbox:number[],confidence:number}>}>}
 */
export async function runOcr(canvas, onStage) {
  const report = (...a) => { if (typeof onStage === "function") onStage(...a); };
  report("model-load");
  const svc = await initOcr();

  const strips = planStrips(canvas.height);
  // per-box: 検出ボックスを1つずつ認識（密な表ではper-lineより適切）。
  const recOpts = { flatten: true, noCache: true, strategy: "per-box" };
  const collected = [];
  const texts = [];

  for (let i = 0; i < strips.length; i++) {
    report("recognize", `${i + 1}/${strips.length}`);
    const { y0, y1 } = strips[i];
    const stripH = y1 - y0;
    const strip = cropStrip(canvas, y0, y1);
    const result = await svc.recognize(strip, recOpts);
    texts.push(result.text || "");
    for (const r of result.results || []) {
      const top = r.box.y;
      const bottom = r.box.y + r.box.height;
      // 画像端でない帯の切れ目に接する box は見切れている可能性が高い。
      // その行は重なりにより隣の帯の内部で完全に検出されるので、ここでは捨てる。
      if (i > 0 && top <= EDGE_MARGIN) continue;
      if (i < strips.length - 1 && bottom >= stripH - EDGE_MARGIN) continue;
      collected.push({
        text: r.text,
        x: r.box.x,
        y: r.box.y + y0, // 帯ローカル座標 → 画像全体の座標へ
        w: r.box.width,
        h: r.box.height,
        confidence: r.confidence,
      });
    }
    strip.width = 0; // バッキングストアを解放してGCを促す
    strip.height = 0;
    await new Promise((res) => setTimeout(res, 30)); // ブラウザに猶予を与える
  }

  const boxes = dedupeBoxes(collected).map((b) => ({
    text: b.text,
    bbox: [b.x, b.y, b.x + b.w, b.y + b.h],
    confidence: b.confidence,
  }));
  return { text: texts.join("\n"), boxes };
}

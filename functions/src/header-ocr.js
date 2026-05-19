// functions/src/header-ocr.js
// 営業明細ヘッダー（処理日付・出庫日時・入庫日時・走行KM）の読み取り。
// 表OCRパイプラインとは独立。生画像を正立回転し、上部帯を拡大してOCRする。
// 画像・canvas はすべてメモリ上のみ。ディスクに保存しない。

import { loadImage, createCanvas } from "ppu-ocv";
import { recognizeHeaderBoxes } from "./ocr-engine.js";

// ラベルboxの近傍下方から値boxを1つ選ぶ。
// label の下辺からの y差 [minDy,maxDy]、x中心差 |dx| < maxDx の範囲で、
// pickValue(text) が非nullを返す最初の（最も近い）boxの結果を返す。
// 基準にラベル下辺(bbox[3])を使うのは、ラベルが高い場合に自身の隣のboxを
// 誤って値として拾わないため。
function valueBelow(boxes, label, { minDy, maxDy, maxDx }, pickValue) {
  const lx = (label.bbox[0] + label.bbox[2]) / 2;
  const ly = label.bbox[3];
  const cands = [];
  for (const b of boxes) {
    if (b === label) continue;
    const bx = (b.bbox[0] + b.bbox[2]) / 2;
    const dy = b.bbox[1] - ly;
    if (dy < minDy || dy > maxDy) continue;
    if (Math.abs(bx - lx) > maxDx) continue;
    const v = pickValue(b.text);
    if (v != null) cands.push({ v, dy });
  }
  cands.sort((a, b) => a.dy - b.dy);
  return cands.length ? cands[0].v : null;
}

// テキストから日付 YYYY/MM/DD を ISO YYYY-MM-DD に。
function pickDate(text) {
  const m = String(text).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// テキストから時刻 HH:MM を抽出（"5/1007:07" のような結合でも末尾の時刻を取る）。
function pickTime(text) {
  const all = String(text).match(/(\d{1,2}):(\d{2})/g);
  if (!all || !all.length) return null;
  const m = all[all.length - 1].match(/(\d{1,2}):(\d{2})/);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// テキストが純粋な整数なら数値に。
function pickInt(text) {
  const t = String(text).trim();
  if (!/^-?\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * ヘッダー帯のOCRボックス配列からヘッダー値を抽出する純粋関数。
 * @param {Array<{text:string,bbox:number[],confidence:number}>} boxes
 * @returns {{date:?string, departTime:?string, returnTime:?string, totalKm:?number}}
 */
export function parseHeaderBoxes(boxes) {
  const result = { date: null, departTime: null, returnTime: null, totalKm: null };
  if (!Array.isArray(boxes)) return result;

  const find = (pred) => boxes.find((b) => pred(String(b.text)));

  const dateLabel = find((t) => t.includes("処理") && t.includes("日付"));
  if (dateLabel) {
    result.date = valueBelow(boxes, dateLabel, { minDy: 10, maxDy: 160, maxDx: 250 }, pickDate);
  }

  const departLabel = find((t) => t.includes("出庫"));
  if (departLabel) {
    result.departTime = valueBelow(boxes, departLabel, { minDy: 10, maxDy: 160, maxDx: 300 }, pickTime);
  }

  const returnLabel = find((t) => t.includes("入庫"));
  if (returnLabel) {
    result.returnTime = valueBelow(boxes, returnLabel, { minDy: 10, maxDy: 160, maxDx: 300 }, pickTime);
  }

  // 走行KM: 「走行」かつ「KM/Km/ＫＭ」を含むラベル（「走行時間」「実車KM」を除外）。
  const kmLabel = find((t) => t.includes("走行") && /K[Mm]|ＫＭ/.test(t));
  if (kmLabel) {
    result.totalKm = valueBelow(boxes, kmLabel, { minDy: 10, maxDy: 160, maxDx: 230 }, pickInt);
  }

  return result;
}

// 生画像をフォームが正立する向きに整える。
// 営業明細は横長の紙に縦長レイアウト。横長写真は時計回り90度回転で正立する
// （2026-05-19検証でCW回転＝正立を確認）。縦長写真はそのまま使う。
function uprightCanvas(img) {
  if (img.width > img.height) {
    const c = createCanvas(img.height, img.width); // 幅=元高さ, 高さ=元幅
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    return c;
  }
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

const HEADER_BAND_RATIO = 0.22; // 正立画像の上部22%にヘッダー全体が収まる
const HEADER_TARGET_WIDTH = 4500; // 帯をこの幅へ拡大（検出が小さい文字を拾える）

/**
 * 生画像Bufferからヘッダー情報を読み取る。
 * 失敗しても例外を投げず、読めなかった項目は null で返す（表OCRを止めないため）。
 * @param {Buffer} imageBuffer 生画像（JPEG/PNG）
 * @returns {Promise<{date:?string, departTime:?string, returnTime:?string, totalKm:?number}>}
 */
export async function extractHeader(imageBuffer) {
  const empty = { date: null, departTime: null, returnTime: null, totalKm: null };
  try {
    const img = await loadImage(imageBuffer);
    const upright = uprightCanvas(img);
    const bandH = Math.round(upright.height * HEADER_BAND_RATIO);
    const scale = HEADER_TARGET_WIDTH / upright.width;
    const band = createCanvas(
      Math.round(upright.width * scale),
      Math.round(bandH * scale)
    );
    band
      .getContext("2d")
      .drawImage(upright, 0, 0, upright.width, bandH, 0, 0, band.width, band.height);
    const boxes = await recognizeHeaderBoxes(band);
    return parseHeaderBoxes(boxes);
  } catch (e) {
    console.warn("extractHeader: 失敗、ヘッダーは空で返す:", (e && e.message) || e);
    return empty;
  }
}

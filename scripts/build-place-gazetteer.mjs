#!/usr/bin/env node
// 営業明細OCRの地名補正辞書 functions/data/tokyo-chome.json を生成する。
//
// 出典: geolonia/japanese-addresses（api/ja.json ＋ api/ja/<都道府県>/<市区町村>.json）
//
// 収録範囲:
//   wards … 関東1都6県の市区町村名（政令市は「横浜市中区」形式に加え素の「横浜市」も入れる。
//           OCR が区を落としたときに区名マッチが外れて補正不能になるのを防ぐため）
//   towns … 東京都・神奈川県・千葉県・埼玉県の町名（丁目を除去して重複排除）
//           営業範囲が都県境をまたぐため。北関東3県は市区町村名のみ（町名まで持つと
//           ファイルが膨らむわりに実利が薄い）。
//
// 町名リストは市区町村ごとに引くので、県をまたいで候補が混ざることはない
// （江東区の候補に市川市の町名が入る、といった誤補正は構造的に起きない）。
//
// 使い方: node scripts/build-place-gazetteer.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://geolonia.github.io/japanese-addresses/api";
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "functions", "data", "tokyo-chome.json",
);

// 市区町村名を収録する県（区名マッチ用）
const WARD_PREFS = [
  "東京都", "神奈川県", "千葉県", "埼玉県", "茨城県", "栃木県", "群馬県",
];
// 町名まで収録する県（営業範囲）
const TOWN_PREFS = ["東京都", "神奈川県", "千葉県", "埼玉県"];

// 「一丁目」「1丁目」等を落とす。町名本体だけを辞書に入れる
// （place-correct 側で末尾の丁目数字を分離してから照合するため）。
const stripChome = (town) =>
  String(town || "")
    .replace(/[0-9０-９一二三四五六七八九十〇]+丁目$/, "")
    .trim();

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// 同時実行数を絞って順に処理する（相手はGitHub Pages）。
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const index = await getJSON(`${BASE}/ja.json`);

// --- wards ---
const wards = new Set();
for (const pref of WARD_PREFS) {
  for (const city of index[pref] || []) {
    wards.add(city);
    // 政令市「横浜市中区」→ 素の「横浜市」も候補に入れる
    const m = city.match(/^(.+?市)(.+区)$/);
    if (m) wards.add(m[1]);
  }
}

// --- towns ---
const towns = {};
let fetched = 0;
for (const pref of TOWN_PREFS) {
  const cities = index[pref] || [];
  await mapLimit(cities, 8, async (city) => {
    const list = await getJSON(
      `${BASE}/ja/${encodeURIComponent(pref)}/${encodeURIComponent(city)}.json`,
    );
    const names = new Set();
    for (const row of list) {
      const t = stripChome(row.town);
      if (t) names.add(t);
    }
    // 並び順は出典のまま（同点候補の選ばれ方が並び順で変わるため、既存の挙動を保つ）
    if (names.size) towns[city] = [...names];
    fetched++;
    if (fetched % 40 === 0) console.error(`  ${fetched} 市区町村`);
  });
}

const out = {
  _source: "geolonia/japanese-addresses api/ja.json + api/ja/<都道府県>/<市区町村>.json",
  _generated: new Date().toISOString().slice(0, 10),
  _note:
    "丁目除去。市区町村名は関東1都6県を収録(政令市は区つき・素の市名の両方)。" +
    "町名(丁目除去)は東京都・神奈川県・千葉県・埼玉県。町名は市区町村ごとに引くので県をまたいだ誤補正は起きない。",
  _script: "scripts/build-place-gazetteer.mjs",
  wards: [...wards],
  towns,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const townCount = Object.values(towns).reduce((s, v) => s + v.length, 0);
console.error(
  `wrote ${OUT}\n  市区町村: ${out.wards.length} / 町名を持つ市区町村: ${Object.keys(towns).length} / 町名: ${townCount}\n  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`,
);

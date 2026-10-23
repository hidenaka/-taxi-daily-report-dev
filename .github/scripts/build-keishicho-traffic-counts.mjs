// 警視庁「主要交差点交通量（区部）」の公式 CSV 一式 ZIP から、地図用の静的 JSON を作る（手動で実行）。
//
// 使い方（手順の全体は docs/roadwork/keishicho-traffic-counts.md）:
//   node .github/scripts/build-keishicho-traffic-counts.mjs --zip <落としたZIP> --fetched-at 2026-10-22
//
// 入力:
//   --zip         公式 ZIP（02_kousatenkubu_csv.zip）。ブラウザからは取りに行かない
//   --fetched-at  ZIP を取得した日（YYYY-MM-DD）。生成物に残す
//   --coords      地点の座標と確認状態（既定 .github/scripts/data/keishicho-coords-r6.json）
//   --arms        流入方向の地図上の向き（既定 .github/scripts/data/keishicho-arms-r6.json。無ければ向きなし）
// 出力:
//   tools/data/keishicho-traffic-counts.json        地図に出す地点（座標を確認済みのものだけ）
//   docs/roadwork/keishicho-traffic-counts-quality.json  変換済み・表示・未配置の地点数と、合計の食い違いなど
//
// 同じ入力からは、並び順を含めて同じ JSON ができる（日時や乱数を入れない）。
// 毎日の自動更新には入れない。警視庁が公表を更新したときに手で実行する。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readZip, decodeCp932 } from './lib/read-zip.mjs';
import { buildPoint, validatePublicData, PUBLIC_COORD_STATUSES } from '../../tools/js/traffic-count-data.js';

export const SCRIPT_VERSION = '1.0.0';
export const SOURCE_URL = 'https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/tokei_jokyo/ryo.files/02_kousatenkubu_csv.zip';
export const SOURCE_PAGE = 'https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/tokei_jokyo/ryo.html';
export const ATTRIBUTION = '「交通量統計表 令和6年 主要交差点交通量（区部）」（警視庁）を加工して作成';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const KINDS = ['houkou', 'ryuusyutu', 'jitensya'];

/** ZIP の中身 → 地点番号ごとの3種の CSV 文字列。対象外のファイル名も返す */
export function groupCsvFiles(entries) {
  const byPoint = new Map();
  const ignored = [];
  for (const e of entries) {
    const m = basename(e.name).match(/^kousaten_(\d+)_(houkou|ryuusyutu|jitensya)\.csv$/);
    if (!m) { ignored.push(basename(e.name)); continue; }
    const id = Number(m[1]);
    if (!byPoint.has(id)) byPoint.set(id, {});
    byPoint.get(id)[m[2]] = { name: basename(e.name), text: decodeCp932(e.data) };
  }
  return { byPoint, ignored: ignored.sort() };
}

/** 変換の本体（ファイルの読み書きをしない部分）。テストからも呼ぶ */
export function convert({ entries, zipFileName, zipSha256, fetchedAt, coords, arms = {} }) {
  const { byPoint, ignored } = groupCsvFiles(entries);
  const converted = [];
  const issues = [];
  for (const id of [...byPoint.keys()].sort((a, b) => a - b)) {
    const files = byPoint.get(id);
    const lacking = KINDS.filter((k) => !files[k]);
    if (lacking.includes('houkou')) { issues.push({ pointId: id, message: '流入方向別 CSV が無い' }); continue; }
    for (const k of lacking) issues.push({ pointId: id, message: `${k} の CSV が無い` });
    const r = buildPoint({ houkou: files.houkou.text, ryuusyutu: files.ryuusyutu?.text, jitensya: files.jitensya?.text });
    if (r.point.pointId !== id) issues.push({ pointId: id, message: `ファイル名の地点番号と中身の地点番号 ${r.point.pointId} が違う` });
    issues.push(...r.issues);
    converted.push({
      ...r.point,
      sourceFiles: KINDS.filter((k) => files[k]).map((k) => files[k].name),
      // 公式の表の中で合計が合わない箇所の数（中身は品質レポート）。画面で注意を出す
      sumMismatchCount: r.issues.filter((x) => x.message.includes('合わない')).length,
    });
  }

  const shown = [];
  const notShown = [];
  for (const p of converted) {
    const c = coords[String(p.pointId)];
    if (c && PUBLIC_COORD_STATUSES.includes(c.coordinateStatus)) {
      shown.push({
        ...p,
        lat: c.lat, lon: c.lon,
        coordinateSource: c.coordinateSource,
        coordinateCheckedAt: c.coordinateCheckedAt,
        coordinateStatus: c.coordinateStatus,
        // 目で確かめた向きがある地点だけ、方向記号ごとの向き（度・北が0の時計回り）を持つ。地図の矢印に使う
        ...(arms[String(p.pointId)]?.status === 'verified-visual' ? { armBearings: arms[String(p.pointId)].bearings } : {}),
      });
    } else {
      notShown.push({ pointId: p.pointId, name: p.name, crossRoads: p.crossRoadsRaw, coordinateStatus: c?.coordinateStatus || 'unplaced', note: c?.note || '' });
    }
  }

  const surveyYearMonths = [...new Set(converted.map((p) => p.surveyYearMonth))].sort();
  const counts = { converted: converted.length, shown: shown.length, unplaced: notShown.length, withArms: shown.filter((p) => p.armBearings).length };
  const meta = {
    title: '警視庁 主要交差点交通量（区部）令和6年',
    nature: '調査日の7時〜19時に観測した実績。現在の交通量・通常日の代表値・渋滞予測ではない',
    sourcePage: SOURCE_PAGE,
    sourceUrl: SOURCE_URL,
    attribution: ATTRIBUTION,
    license: '警視庁ホームページの「権利・リンク」に従う（出典の記載・加工した旨の記載）',
    fetchedAt,
    zipFileName,
    zipSha256,
    scriptVersion: SCRIPT_VERSION,
    surveyYearMonths,
    counts,
    ignoredFiles: ignored,
  };
  const doc = { meta, points: shown };
  const report = {
    meta: { ...meta },
    unplaced: notShown,
    issues,
  };
  return { doc, report };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** 決まった形で書き出す（並び・改行を固定して、同じ入力なら同じバイト列にする） */
export const stableJson = (o) => `${JSON.stringify(o)}\n`;

function main() {
  const zipPath = arg('zip');
  const fetchedAt = arg('fetched-at');
  const coordsPath = resolve(arg('coords', `${ROOT}/.github/scripts/data/keishicho-coords-r6.json`));
  const outPath = resolve(arg('out', `${ROOT}/tools/data/keishicho-traffic-counts.json`));
  const reportPath = resolve(arg('report', `${ROOT}/docs/roadwork/keishicho-traffic-counts-quality.json`));
  if (!zipPath || !/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt || '')) {
    console.error('使い方: node .github/scripts/build-keishicho-traffic-counts.mjs --zip <ZIP> --fetched-at YYYY-MM-DD');
    process.exit(2);
  }
  const buf = readFileSync(zipPath);
  const coords = JSON.parse(readFileSync(coordsPath, 'utf8')).points || {};
  const armsPath = resolve(arg('arms', `${ROOT}/.github/scripts/data/keishicho-arms-r6.json`));
  const arms = existsSync(armsPath) ? JSON.parse(readFileSync(armsPath, 'utf8')).points || {} : {};
  const { doc, report } = convert({
    entries: readZip(buf),
    zipFileName: basename(SOURCE_URL),
    zipSha256: createHash('sha256').update(buf).digest('hex'),
    fetchedAt,
    coords,
    arms,
  });
  const errs = validatePublicData(doc);
  if (errs.length) {
    console.error('生成物の検査で問題が見つかりました:\n' + errs.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(outPath, stableJson(doc));
  writeFileSync(reportPath, stableJson(report));
  const c = doc.meta.counts;
  console.log(`変換済み ${c.converted} 地点 / 地図に出す ${c.shown} 地点（向きあり ${c.withArms}）/ 未配置 ${c.unplaced} 地点 / 品質メモ ${report.issues.length} 件`);
  console.log(`→ ${outPath}\n→ ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();

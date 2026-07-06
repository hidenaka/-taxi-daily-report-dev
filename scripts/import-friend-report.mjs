#!/usr/bin/env node
/**
 * import-friend-report.mjs
 *
 * 知人のタクシー日報を GitHub data リポ (data/drives/{userId}/{date}.json) に保存する。
 * モード A --photo: 写真 → gemini OCR → parse → push (1枚セット)
 * モード B --text:  OCR 済みテキスト → parse → 一括 push
 *
 * 使い方:
 *   node scripts/import-friend-report.mjs --user <userId> --photo <path> [options]
 *   node scripts/import-friend-report.mjs --user <userId> --text <path> [--text <path>...] [options]
 * オプション: --date <YYYY-MM-DD> (--photo のみ)  --vehicle <premium|japantaxi>  --dry-run
 * 必須環境変数: GITHUB_TOKEN, DATA_REPO (dry-run 以外), GEMINI_API_KEY (--photo のみ)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { inferVehicleType } from './lib/infer-vehicle.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const PROMPT_FILE = resolve(__dirname, 'prompts/friend-report.md');
const PARSER_PATH = resolve(REPO_ROOT, 'js/parser.js');
const API_BASE = 'https://api.github.com';
const SLEEP_MS = 200;

// ─── ユーティリティ ───────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function usage() {
  console.error([
    '使い方:',
    '  node scripts/import-friend-report.mjs --user <userId> --photo <path> [options]',
    '  node scripts/import-friend-report.mjs --user <userId> --text <path> [--text <path>...] [options]',
    '必須: --user, および --photo または --text (どちらか一方)',
    'オプション: --date <YYYY-MM-DD> (--photo のみ)  --vehicle <premium|japantaxi>  --dry-run',
    '環境変数: GITHUB_TOKEN, DATA_REPO (dry-run 以外で必須), GEMINI_API_KEY (--photo で必須)',
  ].join('\n'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { user: null, photos: [], texts: [], date: null, vehicle: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if      (a === '--user'    && args[i+1]) opts.user = args[++i];
    else if (a === '--photo'   && args[i+1]) opts.photos.push(args[++i]);
    else if (a === '--text'    && args[i+1]) opts.texts.push(args[++i]);
    else if (a === '--date'    && args[i+1]) opts.date = args[++i];
    else if (a === '--vehicle' && args[i+1]) opts.vehicle = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else { console.error(`不明なオプション: ${a}`); usage(); process.exit(1); }
  }
  return opts;
}

function validate(opts) {
  const errors = [];
  if (!opts.user) errors.push('--user が指定されていません');
  else if (!/^[a-z0-9][a-z0-9_]*$/.test(opts.user))
    errors.push(`--user "${opts.user}" は無効です。英小文字または数字始まり、英小文字・数字・アンダースコアのみ使用可`);

  const hasPhotos = opts.photos.length > 0;
  const hasTexts  = opts.texts.length > 0;
  if (hasPhotos && hasTexts)   errors.push('--photo と --text は同時に指定できません');
  else if (!hasPhotos && !hasTexts) errors.push('--photo または --text のどちらかを1つ以上指定してください');

  if (hasPhotos) {
    const missing = opts.photos.filter(p => !existsSync(resolve(p)));
    if (missing.length) errors.push(`写真ファイルが見つかりません: ${missing.join(', ')}`);
  }
  if (hasTexts) {
    const missing = opts.texts.filter(p => !existsSync(resolve(p)));
    if (missing.length) errors.push(`テキストファイルが見つかりません: ${missing.join(', ')}`);
    if (opts.date) console.warn('[警告] --text モードでは --date は無視されます。日付はファイル内の「日付:」ヘッダーから取得します。');
  }
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date))
    errors.push(`--date "${opts.date}" は YYYY-MM-DD 形式で指定してください`);
  if (opts.vehicle && !['premium', 'japantaxi'].includes(opts.vehicle))
    errors.push(`--vehicle "${opts.vehicle}" は無効です。premium または japantaxi を指定してください`);
  if (!opts.dryRun) {
    if (!process.env.GITHUB_TOKEN) errors.push('環境変数 GITHUB_TOKEN が未設定です');
    if (!process.env.DATA_REPO)    errors.push('環境変数 DATA_REPO が未設定です');
  }
  return errors;
}

// ─── gemini OCR ───────────────────────────────────────────────────

async function runGeminiOCR(photoPaths) {
  const promptText = readFileSync(PROMPT_FILE, 'utf-8');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('環境変数 GEMINI_API_KEY が未設定です');

  const absPhotoPaths = photoPaths.map(p => resolve(p));
  const pyScript = `
import sys,json,mimetypes
import google.genai as genai
from google.genai import types
client=genai.Client(api_key=${JSON.stringify(apiKey)})
paths=json.loads(${JSON.stringify(JSON.stringify(absPhotoPaths))})
prompt=json.loads(${JSON.stringify(JSON.stringify(promptText))})
parts=[]
for p in paths:
    mime,_=mimetypes.guess_type(p)
    data=open(p,'rb').read()
    parts.append(types.Part.from_bytes(data=data,mime_type=mime or'image/jpeg'))
parts.append(types.Part.from_text(text=prompt))
r=client.models.generate_content(model='gemini-2.0-flash',contents=parts,config=types.GenerateContentConfig(temperature=0))
sys.stdout.write(r.text)
`;
  console.log(`[gemini] 写真 ${photoPaths.length} 枚を読み込み中...`);
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execFileAsync('python3', ['-c', pyScript], {
      timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (err) {
    if (err.stderr) process.stderr.write(err.stderr);
    const errTxt = `/tmp/import-err-${Date.now()}.txt`;
    writeFileSync(errTxt, `stdout:\n${err.stdout || ''}\nstderr:\n${err.stderr || ''}`);
    throw new Error(`gemini 実行失敗 (詳細: ${errTxt}): ${err.message}`);
  }
  if (stderr) process.stderr.write(stderr);
  const result = (stdout || '').trim();
  if (!result) throw new Error('gemini の出力が空でした');
  return result;
}

// ─── パーサー & 車種 ──────────────────────────────────────────────

async function parseOutput(text) {
  const { parseFormattedReport } = await import(new URL(`file://${PARSER_PATH}`).href);
  return parseFormattedReport(text);
}

function resolveVehicle(opts, parsed) {
  if (opts.vehicle) return { vehicleType: opts.vehicle, vehicleSource: 'cli', pickupRatio: null };
  if (parsed.vehicleType) return { vehicleType: parsed.vehicleType, vehicleSource: 'gemini', pickupRatio: null };
  const inf = inferVehicleType(parsed.trips);
  return { vehicleType: inf.value, vehicleSource: inf.source, pickupRatio: inf.ratio };
}

function vehicleLabel(vehicleType, vehicleSource, pickupRatio) {
  if (vehicleSource === 'cli')    return `${vehicleType} (CLI 指定)`;
  if (vehicleSource === 'gemini') return `${vehicleType} (gemini 読取)`;
  if (vehicleSource === 'parsed') return `${vehicleType} (ファイル読取)`;
  if (vehicleSource === 'auto')   return `${vehicleType} (自動判定: 迎車率 ${(pickupRatio * 100).toFixed(1)}%)`;
  return '(不明)';
}

// ─── GitHub Contents API ──────────────────────────────────────────

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

function encodeJson(obj) {
  return Buffer.from(JSON.stringify(obj, null, 2), 'utf-8').toString('base64');
}

async function getFileSha(repo, token, path) {
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, { headers: authHeaders(token) });
  await sleep(SLEEP_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} (GET ${path})`);
  return (await res.json()).sha;
}

async function putFile(repo, token, path, obj, message, sha) {
  const body = { message, content: encodeJson(obj) };
  if (sha) body.sha = sha;
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await sleep(SLEEP_MS);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} (PUT ${path}): ${await res.text()}`);
  return res.json();
}

async function pushOne(repo, token, userId, drive) {
  const githubPath = `data/drives/${userId}/${drive.date}.json`;
  const sha = await getFileSha(repo, token, githubPath);
  const message = sha ? `update drive ${userId}/${drive.date}` : `add drive ${userId}/${drive.date}`;
  const result = await putFile(repo, token, githubPath, drive, message, sha);
  return { githubPath, sha, commitSha: result?.commit?.sha?.slice(0, 7) || 'ok' };
}

// ─── インタラクティブ確認 ──────────────────────────────────────────

function confirm(prompt) {
  if (!process.stdin.isTTY) {
    console.error('[エラー] 標準入力が TTY ではありません。--dry-run で確認してから手動実行してください。');
    process.exit(1);
  }
  return new Promise(r => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => { rl.close(); r(answer.trim().toLowerCase()); });
  });
}

// ─── --text モード ────────────────────────────────────────────────

function saveFailed(failures, timestamp) {
  return failures.map((f, idx) => {
    const p = `/tmp/import-failed-${timestamp}-${idx}.txt`;
    writeFileSync(p, f.rawText || `[ファイル読み込み失敗]\n${f.error}`, 'utf-8');
    console.log(`  保存: ${p} (元ファイル: ${f.path})`);
    return p;
  });
}

async function runTextMode(opts) {
  const { token, repo } = { token: process.env.GITHUB_TOKEN, repo: process.env.DATA_REPO };
  const timestamp = Date.now();

  // 1. 各ファイルをパース
  const results = [];
  for (const textPath of opts.texts) {
    const absPath = resolve(textPath);
    let rawText;
    try { rawText = readFileSync(absPath, 'utf-8'); }
    catch (err) { results.push({ path: absPath, error: `ファイル読み込み失敗: ${err.message}`, drive: null }); continue; }

    let parsed;
    try { parsed = await parseOutput(rawText); }
    catch (err) { results.push({ path: absPath, error: `parseFormattedReport: ${err.message}`, drive: null, rawText }); continue; }

    if (!parsed.date) {
      results.push({ path: absPath, error: '日付が見つかりません。ファイル内の「日付:」ヘッダーを確認してください。', drive: null, rawText });
      continue;
    }

    const { vehicleType, vehicleSource, pickupRatio } = resolveVehicle(opts, parsed);
    const drive = { date: parsed.date, vehicleType, departureTime: parsed.departureTime, returnTime: parsed.returnTime, trips: parsed.trips, rests: parsed.rests };
    results.push({ path: absPath, error: null, drive, vehicleSource, pickupRatio });
  }

  // 2. プレビュー
  const total = results.length;
  const successes = results.filter(r => !r.error);
  const failures  = results.filter(r => r.error);

  console.log(`\n=== 取込予定 (${opts.user}, ${total}ファイル) ===\n`);
  results.forEach((r, i) => {
    const prefix = `[${i+1}/${total}] ${r.path}`;
    if (r.error) {
      console.log(`${prefix}  ⚠ パースエラー\n  エラー: ${r.error}`);
    } else {
      const d = r.drive;
      const amt = d.trips.filter(t => !t.isCancel).reduce((s, t) => s + (t.amount || 0), 0);
      console.log(`${prefix}\n  日付: ${d.date} | 車種: ${vehicleLabel(d.vehicleType, r.vehicleSource, r.pickupRatio)}`);
      console.log(`  出庫: ${d.departureTime || '(不明)'} | 帰庫: ${d.returnTime || '(不明)'}`);
      console.log(`  乗務: ${d.trips.length}件 | 休憩: ${d.rests.length}件 | 合計: ¥${amt.toLocaleString('ja-JP')}`);
    }
    console.log('');
  });

  const pushTotal = successes.reduce((s, r) => s + r.drive.trips.filter(t => !t.isCancel).reduce((a, t) => a + (t.amount || 0), 0), 0);
  const pushTrips = successes.reduce((s, r) => s + r.drive.trips.length, 0);
  console.log('=== サマリ ===');
  console.log(`成功: ${successes.length}件 / 失敗: ${failures.length}件`);
  if (successes.length > 0) console.log(`push 対象合計: ¥${pushTotal.toLocaleString('ja-JP')}, ${pushTrips}乗務`);

  // 3. dry-run
  if (opts.dryRun) {
    console.log('\n[DRY RUN] GitHub への push はスキップします。');
    successes.forEach(r => console.log(`WOULD PUSH: data/drives/${opts.user}/${r.drive.date}.json`));
    if (failures.length) console.log(`\nパースエラー: ${failures.length}件 (push されません)`);
    process.exit(failures.length > 0 ? 1 : 0);
  }

  if (successes.length === 0) {
    console.error('\n[エラー] push できるファイルがありません。');
    saveFailed(failures, timestamp);
    process.exit(1);
  }

  // 4. 確認 (1回)
  const skipMsg = failures.length > 0 ? ` (失敗${failures.length}件はスキップされます)` : '';
  const answer = await confirm(`\n${successes.length}件を push しますか?${skipMsg} [y/n]: `);
  if (answer !== 'y' && answer !== 'yes') {
    console.log('中断しました。');
    saveFailed(failures, timestamp);
    process.exit(0);
  }

  // 5. 順次 push
  console.log('');
  const pushErrors = [];
  for (let i = 0; i < successes.length; i++) {
    const r = successes[i];
    process.stdout.write(`[${i+1}/${successes.length}] ${r.drive.date}.json: pushing...`);
    try {
      const { commitSha } = await pushOne(repo, token, opts.user, r.drive);
      console.log(` pushed (sha=${commitSha})`);
    } catch (err) {
      console.log(` FAILED`);
      pushErrors.push({ date: r.drive.date, error: err.message });
    }
  }

  // 6. 末尾サマリ
  console.log('\n=== 完了 ===');
  console.log(`成功 push: ${successes.length - pushErrors.length}件`);
  if (failures.length > 0) {
    const saved = saveFailed(failures, timestamp);
    console.log(`パースエラー: ${failures.length}件 (${saved.join(', ')} に保存)`);
  } else {
    console.log('パースエラー: 0件');
  }
  console.log(`push エラー: ${pushErrors.length}件`);
  pushErrors.forEach(e => console.error(`  ${e.date}: ${e.error}`));
  process.exit(failures.length > 0 || pushErrors.length > 0 ? 1 : 0);
}

// ─── メイン ───────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const errors = validate(opts);
  if (errors.length > 0) { for (const e of errors) console.error(`エラー: ${e}`); usage(); process.exit(1); }

  if (opts.texts.length > 0) { await runTextMode(opts); return; }

  // --photo モード
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.DATA_REPO;

  let rawText;
  try { rawText = await runGeminiOCR(opts.photos); }
  catch (err) { console.error(`[OCR失敗] ${err.message}`); process.exit(1); }

  console.log('\n[OCR出力]\n' + '─'.repeat(60));
  console.log(rawText);
  console.log('─'.repeat(60));

  let parsed;
  try { parsed = await parseOutput(rawText); }
  catch (err) {
    const f = `/tmp/import-${Date.now()}.txt`;
    writeFileSync(f, rawText, 'utf-8');
    console.error(`[パース失敗] ${err.message}\nOCR 出力を保存しました: ${f}`);
    process.exit(1);
  }

  if (parsed.trips.length === 0) {
    const f = `/tmp/import-${Date.now()}.txt`;
    writeFileSync(f, rawText, 'utf-8');
    console.error(`[警告] 乗務データが0件です。OCR 出力を確認してください。元テキストは ${f} に保存しました。`);
    process.exit(1);
  }

  const date = parsed.date || opts.date;
  if (!date) { console.error('[エラー] OCR が日付を読み取れませんでした。--date YYYY-MM-DD で明示してください。'); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error(`[エラー] 日付フォーマットが不正です: "${date}". YYYY-MM-DD 形式が必要です。`); process.exit(1); }

  const { vehicleType, vehicleSource, pickupRatio } = resolveVehicle(opts, parsed);
  const drive = { date, vehicleType, departureTime: parsed.departureTime, returnTime: parsed.returnTime, trips: parsed.trips, rests: parsed.rests };

  const totalAmount = drive.trips.filter(t => !t.isCancel).reduce((s, t) => s + (t.amount || 0), 0);
  const githubPath = `data/drives/${opts.user}/${drive.date}.json`;
  console.log([
    '\n[プレビュー]',
    `  ユーザー    : ${opts.user}`,
    `  日付        : ${drive.date}`,
    `  車種        : ${vehicleLabel(vehicleType, vehicleSource, pickupRatio)}`,
    `  出庫        : ${drive.departureTime || '(不明)'}`,
    `  帰庫        : ${drive.returnTime || '(不明)'}`,
    `  乗務件数    : ${drive.trips.length} 件`,
    `  休憩        : ${drive.rests.length} 件`,
    `  売上合計    : ¥${totalAmount.toLocaleString('ja-JP')}`,
    `  保存先      : ${githubPath}`,
  ].join('\n'));

  if (opts.dryRun) {
    console.log('\n[DRY RUN] GitHub への push はスキップします。');
    console.log(`WOULD PUSH: ${githubPath}\n${JSON.stringify(drive, null, 2)}`);
    process.exit(0);
  }

  const answer = await confirm('\nこの内容で GitHub に保存しますか? [y/N] ');
  if (answer !== 'y' && answer !== 'yes') { console.log('中断しました。'); process.exit(0); }

  console.log('\n[GitHub] push 中...');
  try {
    const { sha, commitSha } = await pushOne(repo, token, opts.user, drive);
    console.log(`[完了] ${githubPath} を ${sha ? '更新' : '新規作成'}しました。(sha=${commitSha})`);
  } catch (err) {
    console.error(`[GitHub push 失敗] ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('予期しないエラー:', err); process.exit(1); });

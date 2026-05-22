// 使い方動画レコーダー（案A: 本物の画面を自動操作して録画）
// 本物の input.html / ocr-import.html を Playwright で開き、実際にクリックしながら
// 「タップ波紋＋字幕」を重ねて録画 → ffmpeg で無音・軽量MP4＋サムネに変換する。
//
// playwright はアプリ本体の依存に入れない。グローバル/npx の playwright を NODE_PATH で解決する：
//   1) ローカルサーバを起動:  (cd <worktree> && python3 -m http.server 8782 >/dev/null 2>&1 &)
//   2) 録画:  NODE_PATH="$(npm root -g)" node scripts/record-help-video.mjs <scenario> <out.mp4> [baseUrl]
//      例:    NODE_PATH="$(npm root -g)" node scripts/record-help-video.mjs input-paste media/help/input-paste.mp4
//
// UIが変わったらこのスクリプトを再実行するだけで動画を作り直せる（再現可能）。
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// playwright はアプリ依存に入れないため、グローバル解決（NODE_PATH="$(npm root -g)"）。
// ESM は NODE_PATH を見ないので createRequire(=CommonJS解決) で読む。
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const VIEWPORT = { width: 380, height: 780 };

// ---- シナリオ定義（fn は page と ui を受け取り、操作＋字幕＋波紋を行う）----
const SCENARIOS = {
  'input-paste': {
    path: 'input.html',
    async run(page, ui) {
      // 正しい書式の日報（売上5,700円・2件）をコピペする見せ方
      const SAMPLE = [
        '日付: 2026-04-26',
        '車種: premium',
        '出庫: 07:00',
        '帰庫: 01:16',
        '---',
        'No,乗車,降車,時間,迎,乗車地,降車地,営Km,男,女,合計',
        '1,07:17,07:38,0:21,迎,大田区上池台4,港区港南2,6.7,1,,"3,600"',
        '休,10:47,11:36,0:49,,江東区青海2,,,,,',
        '2,11:40,11:55,0:15,迎,江東区青海2,中央区銀座8,4.2,2,1,"2,100"',
      ].join('\n');
      await page.locator('#rawTextInput').scrollIntoViewIfNeeded();
      await ui.caption('① 日報のテキストをここに貼り付け');
      await ui.ripple('#rawTextInput');
      await page.locator('#rawTextInput').fill(SAMPLE); // コピペのように一括入力
      await page.waitForTimeout(1300);
      await ui.caption('②「テキストを読み込む」をタップ');
      await ui.ripple('#parseBtn');
      await page.locator('#parseBtn').click();
      await page.waitForTimeout(1400);
      // プレビューへスクロール（確認）
      await page.evaluate(() => document.getElementById('previewSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(1200);
      await ui.caption('③ 取り込んだ内容を確認');
      await page.waitForTimeout(1800);
      // 下の「保存」ボタンまでスクロールして見せる
      await page.evaluate(() => document.getElementById('saveBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(1300);
      await ui.caption('④ 最後に「保存」をタップ');
      await ui.ripple('#saveBtn');
      await page.waitForTimeout(2200);
    },
  },
  'ocr-import': {
    path: 'ocr-import.html',
    async run(page, ui) {
      // 写真選択はOSのダイアログで録画に写せず、読み取りは認証+サーバが要るため、
      // 画面に出る状態（解析中→読み取り完了）をモックして一連の流れを見せる。
      await ui.caption('①「画像を選ぶ」をタップ');
      await ui.ripple('#pickLabel');
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const s = document.getElementById('ocrStatus');
        if (s) s.textContent = '解析中…（営業明細を自動で読み取っています）';
      });
      await ui.caption('② 写真を撮る/選ぶと自動で読み取り');
      await page.waitForTimeout(2400);
      await page.evaluate(() => {
        const s = document.getElementById('ocrStatus');
        if (s) s.innerHTML = '読み取り完了: 乗車 2件 ・ 休憩 1回'
          + '<br><span style="color:#2e7d32;font-weight:700;">✓ 本日の残り 99/100回</span>';
      });
      await ui.caption('③ 読み取り完了！入力ページで確認・保存');
      await page.waitForTimeout(2800);
    },
  },
};

// ---- 画面に注入する字幕＆波紋ヘルパー（録画に写る）----
const OVERLAY_INIT = () => {
  // document_start で実行されるため body 未生成。要素は呼び出し時に遅延生成する。
  const ensureStyle = () => {
    if (document.getElementById('hvStyle')) return;
    const css = document.createElement('style');
    css.id = 'hvStyle';
    css.textContent = `
      #hvCaption{position:fixed;left:10px;right:10px;bottom:20px;z-index:99999;
        background:rgba(17,21,26,.95);color:#fff;font:700 21px/1.45 -apple-system,'Hiragino Sans',sans-serif;
        padding:18px 18px;border-radius:14px;text-align:center;opacity:0;transition:opacity .2s;
        box-shadow:0 8px 28px rgba(0,0,0,.45);letter-spacing:.2px;}
      #hvCaption.show{opacity:1;}
      .hvRipple{position:fixed;z-index:99998;width:70px;height:70px;margin:-35px 0 0 -35px;
        border-radius:50%;border:4px solid #ff5252;background:rgba(255,82,82,.3);
        pointer-events:none;animation:hvR 1s ease-out 2;}
      @keyframes hvR{0%{transform:scale(.5);opacity:1;}100%{transform:scale(1.5);opacity:0;}}
    `;
    (document.head || document.documentElement).appendChild(css);
  };
  const ensureCaption = () => {
    let cap = document.getElementById('hvCaption');
    if (!cap) { cap = document.createElement('div'); cap.id = 'hvCaption'; document.body.appendChild(cap); }
    return cap;
  };
  window.__hvCaption = (t) => { ensureStyle(); const cap = ensureCaption(); cap.textContent = t; cap.classList.add('show'); };
  window.__hvRipple = (x, y) => {
    ensureStyle();
    const r = document.createElement('div');
    r.className = 'hvRipple';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 2100);
  };
};

async function main() {
  const scenarioId = process.argv[2];
  const outMp4 = process.argv[3];
  const baseUrl = process.argv[4] || 'http://localhost:8782';
  const sc = SCENARIOS[scenarioId];
  if (!sc || !outMp4) {
    console.error('usage: NODE_PATH="$(npm root -g)" node scripts/record-help-video.mjs <scenario> <out.mp4> [baseUrl]');
    console.error('scenarios:', Object.keys(SCENARIOS).join(', '));
    process.exit(1);
  }

  const videoDir = mkdtempSync(join(tmpdir(), 'hvrec-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  // アクセスゲートを通すための seed（有効サブスク）＋ 字幕/波紋ヘルパー注入
  await context.addInitScript(() => {
    try {
      localStorage.setItem('taxi_user_id', 'demo-help');
      sessionStorage.setItem('taxi_sub_cache_v1', JSON.stringify({
        v: 1, userId: 'demo-help', sub: { status: 'active', plan: 'full' }, cachedAt: Date.now(),
      }));
    } catch {}
  });
  await context.addInitScript(OVERLAY_INIT);

  // 録画用にアクセスゲートを無害化（Firebase 不要・常に許可）＋ SW 無効化（キャッシュ干渉防止）。
  const accessSrc = readFileSync('js/access-control.js', 'utf8').replace(
    'export async function enforceAccess(feature, options = {}) {',
    "export async function enforceAccess(feature, options = {}) { try { document.body.style.visibility='visible'; document.body.style.pointerEvents='auto'; } catch(e){} return true;"
  );
  await context.route('**/js/access-control.js', (r) =>
    r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: accessSrc }));
  await context.route('**/sw.js', (r) =>
    r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: '/* sw disabled for recording */' }));

  const page = await context.newPage();
  const ui = {
    async caption(t) { await page.evaluate((x) => window.__hvCaption(x), t); await page.waitForTimeout(500); },
    async ripple(sel) {
      const box = await page.locator(sel).boundingBox();
      if (box) await page.evaluate(([x, y]) => window.__hvRipple(x, y),
        [box.x + box.width / 2, box.y + box.height / 2]);
      await page.waitForTimeout(900);
    },
  };

  await page.goto(`${baseUrl}/${sc.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!page.url().includes(sc.path)) {
    throw new Error(`アクセスゲートでリダイレクトされました: ${page.url()}（seedを確認）`);
  }
  await sc.run(page, ui);
  await page.waitForTimeout(400);

  await context.close(); // ここで webm が確定保存される
  await browser.close();

  const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  const webmPath = join(videoDir, webm);
  const poster = outMp4.replace(/\.mp4$/, '.jpg');

  // webm → 無音・縦・H.264・faststart の軽量MP4
  execSync(`ffmpeg -y -i "${webmPath}" -an -vf "scale=360:-2" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 28 -preset slow -movflags +faststart "${outMp4}"`, { stdio: 'inherit' });
  // サムネ（1秒地点）
  execSync(`ffmpeg -y -ss 1 -i "${webmPath}" -frames:v 1 -vf "scale=360:-2" -q:v 4 "${poster}"`, { stdio: 'inherit' });
  rmSync(videoDir, { recursive: true, force: true });

  const size = execSync(`du -h "${outMp4}" | cut -f1`).toString().trim();
  console.log(`\n✅ done: ${outMp4} (${size}) / poster: ${poster}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

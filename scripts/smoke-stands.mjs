// scripts/smoke-stands.mjs — stands.html のピン描画をヘッドレス確認
// 使い方: node scripts/smoke-stands.mjs <baseUrl> <userId>
// 例: node scripts/smoke-stands.mjs https://hidenaka.github.io/-taxi-daily-report-dev <京北の検証userId>
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8000';
const userId = process.argv[3];
if (!userId) { console.error('userId が必要（京北所属の検証ユーザー）'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
// access ゲート回避用に localStorage / sub_cache を seed（既存スモーク手順）
await page.addInitScript((uid) => {
  localStorage.setItem('taxi_user_id', uid);
  sessionStorage.setItem('taxi_sub_cache_v1', JSON.stringify({
    userId: uid, ts: Date.now(), sub: { status: 'active', plan: 'full' },
  }));
}, userId);

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/tools/stands.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const count = await page.evaluate(() => window.__standsCount);
const pins = await page.locator('.stand-pin').count();
console.log('console errors:', errors);
console.log('__standsCount =', count, ' .stand-pin DOM =', pins);
if ((count ?? 0) < 1) { console.error('FAIL: stands が読み込まれていない'); process.exit(1); }
console.log('SMOKE OK');
await browser.close();

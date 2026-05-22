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

// ============================================================
// 分析ページ(review.html)録画用のサンプルデータ生成（決定論的）
// review.html は js/storage.js 経由でFirebaseからdriveやConfigを読む。
// 録画時は storage.js をスタブに差し替え、現実的なサンプルを流し込んで
// 推移グラフ／ヒートマップ／ステージ別お手本が意味のある形で描画されるようにする。
// ============================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _pad2 = (n) => String(n).padStart(2, '0');
const _hhmm = (mins) => {
  const h = ((Math.floor(mins / 60) % 24) + 24) % 24;
  return _pad2(h) + ':' + _pad2(((mins % 60) + 60) % 60);
};

// 曜日ごとの「時間帯×お金の重み」。早朝/昼/夕方〜夜/深夜のゾーンに濃淡を作る。
function _hourWeights(dow) {
  const W = new Array(24).fill(0);
  const put = (obj) => { for (const k in obj) W[(+k + 24) % 24] = obj[k]; };
  if (dow >= 1 && dow <= 4) {        // 月〜木: 朝が稼ぎ時・昼は休憩向き
    put({ 7: 6, 8: 7, 9: 5, 10: 3, 11: 2, 12: 1.5, 13: 1.5, 14: 2, 15: 2, 16: 2.5, 17: 3, 18: 3.5, 19: 3, 20: 2.5, 21: 2, 22: 1.5, 23: 1 });
  } else if (dow === 5) {            // 金: 夜〜深夜が稼ぎ時
    put({ 7: 3, 8: 4, 9: 2, 12: 1.5, 13: 1.5, 14: 1.5, 15: 2, 16: 2, 17: 3.5, 18: 5, 19: 5, 20: 5.5, 21: 5.5, 22: 6, 23: 6, 0: 6, 1: 5, 2: 3 });
  } else if (dow === 6) {            // 土: 夜〜深夜が最も濃い
    put({ 9: 2, 10: 2.5, 11: 3, 12: 3, 13: 3, 14: 2.5, 15: 2.5, 16: 3, 17: 4, 18: 5, 19: 5.5, 20: 6, 21: 6, 22: 7, 23: 7, 0: 7, 1: 6, 2: 4 });
  } else {                          // 日: 昼中心・夜は薄い
    put({ 8: 2, 9: 3, 10: 4, 11: 4, 12: 4, 13: 4, 14: 3.5, 15: 3, 16: 3, 17: 3, 18: 2.5, 19: 2, 20: 1.5 });
  }
  return W;
}

function _genDrive(dateStr, seed) {
  const rnd = mulberry32(seed);
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const W = _hourWeights(dow);
  const BASE = [44000, 50000, 51000, 52000, 53000, 84000, 93000]; // 日〜土の1日税込目安
  const target = Math.round((BASE[dow] * (0.82 + rnd() * 0.34)) / 100) * 100;
  const hours = [];
  for (let h = 0; h < 24; h++) if (W[h] > 0) hours.push(h);
  const wsum = hours.reduce((s, h) => s + W[h], 0);
  const isWeekend = dow === 0 || dow === 5 || dow === 6;
  const trips = [];
  for (const h of hours) {
    const hourAmt = target * (W[h] / wsum);
    const n = hourAmt > 5000 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const startM = h * 60 + 4 + Math.floor(rnd() * 51);
      const dur = 8 + Math.floor(rnd() * 24);
      let amt = (hourAmt / n) * (0.78 + rnd() * 0.44);
      if ((dow === 5 || dow === 6) && (h >= 22 || h < 3)) amt *= 0.5 + rnd() * 1.2; // 週末深夜はムラ大→安定度△
      amt = Math.max(710, Math.round(amt / 10) * 10);
      trips.push({ boardTime: _hhmm(startM), alightTime: _hhmm(startM + dur), amount: amt, isCancel: false, boardPlace: '', alightPlace: '' });
    }
  }
  const fromDep = (t) => { const [hh, mm] = t.boardTime.split(':').map(Number); let x = hh * 60 + mm; if (x < 7 * 60) x += 1440; return x; };
  trips.sort((a, b) => fromDep(a) - fromDep(b));
  const lastDep = trips.length ? fromDep(trips[trips.length - 1]) : 8 * 60;
  const returnM = lastDep + 40 + Math.floor(rnd() * 40);
  const wr = rnd();
  const weather = wr < 0.6 ? 'sunny' : wr < 0.8 ? 'cloudy' : 'rainy';
  const rests = [{ startTime: '12:30', endTime: _hhmm(12 * 60 + 50 + Math.floor(rnd() * 30)) }];
  if (isWeekend) rests.push({ startTime: '18:30', endTime: '18:55' });
  return { date: dateStr, vehicleType: 'premium', departureTime: '07:00', returnTime: _hhmm(returnM), trips, rests, weather };
}

// review.html の getBillingPeriod / shiftBillingPeriod と同じ月度ロジック
function _billingPeriodOf(y, m, d) {
  if (m === 2) return d <= 13 ? `${y}-02` : `${y}-03`;
  if (d >= 16) { const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y; return `${ny}-${_pad2(nm)}`; }
  return `${y}-${_pad2(m)}`;
}
function _shiftPeriod(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m <= 0) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${_pad2(m)}`;
}

function buildSampleData() {
  const now = new Date();
  const current = _billingPeriodOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const periods = [];
  for (let i = 5; i >= 0; i--) periods.push(_shiftPeriod(current, -i)); // 直近6ヶ月度
  const DATA = {};
  let seed = 20260522;
  for (const ym of periods) {
    const [y, m] = ym.split('-').map(Number);
    const arr = [];
    for (let day = 1; day <= 28; day++) {
      seed += 7;
      if (mulberry32(seed)() > 0.5) continue; // 約半分を乗務日に（各曜日3日以上を確保）
      arr.push(_genDrive(`${y}-${_pad2(m)}-${_pad2(day)}`, seed * 13 + day));
    }
    DATA[ym] = arr;
  }
  return DATA;
}

// ============================================================
// arrivals シナリオ用サンプルデータ生成
// tools/arrivals.html が fetch する 3 つの JSON を録画時にモックする。
// 現実的な便数・時刻・乗客数を持たせて画面が空にならないようにする。
// ============================================================
function buildArrivalsData() {
  const now = new Date();
  const hh = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const h0 = now.getHours();
  // 現在時刻前後2時間帯を中心に T1/T2 各15便ほど配置
  const airlines = [
    { airline: 'JAL', prefix: 'JL', terminal: 'T1', color: 'airline-jal' },
    { airline: 'JAL', prefix: 'JL', terminal: 'T1', color: 'airline-jal' },
    { airline: 'ANA', prefix: 'NH', terminal: 'T2', color: 'airline-ana' },
    { airline: 'ANA', prefix: 'NH', terminal: 'T2', color: 'airline-ana' },
    { airline: 'JJP', prefix: 'GK', terminal: 'T1', color: 'airline-jjp' },
    { airline: 'SKY', prefix: 'BC', terminal: 'T2', color: 'airline-sky' },
  ];
  const origins = [
    { from: 'ITM', fromName: '伊丹', seats: 200 },
    { from: 'CTS', fromName: '新千歳', seats: 165 },
    { from: 'FUK', fromName: '福岡', seats: 189 },
    { from: 'OKA', fromName: '那覇', seats: 210 },
    { from: 'KIX', fromName: '関西', seats: 158 },
    { from: 'NGO', fromName: '中部', seats: 172 },
    { from: 'HIJ', fromName: '広島', seats: 84 },
    { from: 'KMJ', fromName: '熊本', seats: 74 },
    { from: 'SDJ', fromName: '仙台', seats: 78 },
    { from: 'KOJ', fromName: '鹿児島', seats: 84 },
  ];
  const flights = [];
  let fNum = 100;
  for (let i = -6; i <= 12; i++) {
    const al = airlines[(fNum + i) % airlines.length];
    const or = origins[(fNum + i * 3) % origins.length];
    const baseMin = h0 * 60 + now.getMinutes() + i * 18;
    const hh2 = Math.floor(((baseMin % 1440) + 1440) % 1440 / 60);
    const mm2 = ((baseMin % 60) + 60) % 60;
    const delayMin = i % 5 === 0 ? 35 : 0;
    const estMin = baseMin + delayMin;
    const eh = Math.floor(((estMin % 1440) + 1440) % 1440 / 60);
    const em = ((estMin % 60) + 60) % 60;
    const status = baseMin + 10 < h0 * 60 + now.getMinutes() ? '到着' : delayMin > 0 ? '遅延' : '飛行中';
    const actualTime = status === '到着' ? hh(hh2, mm2 + 10 > 59 ? 0 : mm2 + 10) : null;
    const lf = 0.68 + (i % 4) * 0.07;
    const estPax = Math.round(or.seats * lf);
    flights.push({
      flightNumber: `${al.prefix}${fNum + i * 7}`,
      airline: al.airline,
      from: or.from, fromName: or.fromName,
      terminal: al.terminal,
      isInternational: false,
      scheduledTime: hh(hh2, mm2),
      estimatedTime: hh(eh, em),
      actualTime,
      status,
      aircraftCode: '789',
      seatCount: or.seats,
      loadFactor: lf,
      loadFactorSource: 'route',
      estimatedPax: estPax,
      lobbyExitTime: hh(eh, em + 15 > 59 ? em - 44 : em + 15),
      reachRate: 1,
      reachTier: lf > 0.75 ? 'high' : 'mid',
      estimatedTaxiPax: Math.round(estPax * 0.055),
      taxiBucket: 'daytime',
      taxiBaseRate: 0.055,
      taxiBoost: 1, taxiDelayBoost: delayMin > 0 ? 1.2 : 1,
      taxiLightningBoost: 1, taxiClamped: false,
    });
    fNum += 13;
  }
  // T3 国際線も数便追加
  const intlOrigins = [
    { from: 'ICN', fromName: 'ソウル(仁川)', seats: 280 },
    { from: 'PVG', fromName: '上海(浦東)', seats: 320 },
    { from: 'HKG', fromName: '香港', seats: 248 },
    { from: 'SIN', fromName: 'シンガポール', seats: 280 },
  ];
  for (let i = 0; i < 4; i++) {
    const o = intlOrigins[i];
    const baseMin = h0 * 60 + now.getMinutes() + (i - 1) * 45;
    const hh2 = Math.floor(((baseMin % 1440) + 1440) % 1440 / 60);
    const mm2 = ((baseMin % 60) + 60) % 60;
    const lf = 0.72 + i * 0.04;
    const estPax = Math.round(o.seats * lf);
    flights.push({
      flightNumber: `JL${700 + i * 3}`,
      airline: 'JAL', from: o.from, fromName: o.fromName,
      terminal: 'T3', isInternational: true,
      scheduledTime: hh(hh2, mm2), estimatedTime: hh(hh2, mm2),
      actualTime: null, status: '飛行中',
      aircraftCode: '77W', seatCount: o.seats, loadFactor: lf, loadFactorSource: 'default',
      estimatedPax: estPax, lobbyExitTime: hh(hh2, mm2 + 20 > 59 ? mm2 - 39 : mm2 + 20),
      reachRate: 1, reachTier: 'high', estimatedTaxiPax: Math.round(estPax * 0.09),
      taxiBucket: 'daytime', taxiBaseRate: 0.09, taxiBoost: 1, taxiDelayBoost: 1,
      taxiLightningBoost: 1, taxiClamped: false,
    });
  }
  const updatedAt = new Date().toISOString().replace('Z', '+09:00');
  return {
    updatedAt,
    source: 'sample',
    flights,
    weather: { lightningActive: false, lightningRecoveryStartHHMM: null, weatherCode: 2, temperature: 18.5, precipitation: 0, cloudCover: 40 },
    stats: {
      totalFlights: flights.length,
      unknownAircraft: 0,
      internationalFlights: 4,
      byTerminal: { T1: flights.filter(f => f.terminal === 'T1').length, T2: flights.filter(f => f.terminal === 'T2').length, T3: 4 },
      totalEstimatedTaxiPax: flights.reduce((s, f) => s + f.estimatedTaxiPax, 0),
    },
  };
}

function buildArrivalsActuals() {
  const now = new Date();
  const h0 = now.getHours();
  const pad = (n) => String(n).padStart(2, '0');
  const slots = [];
  // 直前4時間の15分実績スロットを生成（タクシー出庫台数）
  for (let i = -16; i <= 0; i++) {
    const baseMin = h0 * 60 + Math.floor(now.getMinutes() / 15) * 15 + i * 15;
    if (baseMin < 8 * 60) continue; // 8:00起点
    const bm = ((baseMin % 1440) + 1440) % 1440;
    const h = Math.floor(bm / 60);
    const m = bm % 60;
    const end = bm + 15;
    const eh = Math.floor(end / 60);
    const em = end % 60;
    const base = 8 + Math.abs(i % 5);
    slots.push({
      slotStart: `${pad(h)}:${pad(m)}`,
      slotEnd: `${pad(eh)}:${pad(em)}`,
      stall1: base + 3, stall2: base + 2, stall3: 0, stall4: base + 1,
      total: (base + 3) + (base + 2) + (base + 1),
    });
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), slots };
}

function buildArrivalsEnsemble() {
  const now = new Date();
  const h0 = now.getHours();
  const pad = (n) => String(n).padStart(2, '0');
  const slots = [];
  // 今後2時間の5分予測スロットを生成
  for (let i = 0; i <= 24; i++) {
    const baseMin = h0 * 60 + Math.floor(now.getMinutes() / 5) * 5 + i * 5;
    const bm = ((baseMin % 1440) + 1440) % 1440;
    const h = Math.floor(bm / 60);
    const m = bm % 60;
    const base = 2 + Math.abs((i + 2) % 4);
    slots.push({
      slotStart: `${pad(h)}:${pad(m)}`,
      stall1: base + 1, stall2: base, stall3: 0, stall4: Math.max(1, base - 1),
      total: (base + 1) + base + Math.max(1, base - 1),
    });
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), slots };
}

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
    // 日報入力ページから「写真から取り込む」をタップして遷移するところから見せる。
    path: 'input.html',
    async run(page, ui) {
      // ① input.html で「📷 写真から取り込む」をタップ → ページ遷移
      await page.locator('a.btn[href="ocr-import.html"]').scrollIntoViewIfNeeded();
      await ui.caption('①「写真から取り込む」をタップ');
      await ui.ripple('a.btn[href="ocr-import.html"]');
      await page.locator('a.btn[href="ocr-import.html"]').click();
      await page.waitForURL('**/ocr-import.html', { timeout: 15000 });
      await page.waitForTimeout(1000);
      // ② 取り込みページで「画像を選ぶ」
      await ui.caption('②「画像を選ぶ」をタップ');
      await ui.ripple('#pickLabel');
      await page.waitForTimeout(700);
      // 写真選択はOSダイアログで写せず読み取りは認証+サーバ要のため、画面状態をモック
      await page.evaluate(() => {
        const s = document.getElementById('ocrStatus');
        if (s) s.textContent = '解析中…（営業明細を自動で読み取っています）';
      });
      await ui.caption('③ 写真を撮る/選ぶと自動で読み取り');
      await page.waitForTimeout(2400);
      await page.evaluate(() => {
        const s = document.getElementById('ocrStatus');
        if (s) s.innerHTML = '読み取り完了: 乗車 2件 ・ 休憩 1回'
          + '<br><span style="color:#2e7d32;font-weight:700;">✓ 本日の残り 99/100回</span>';
      });
      await ui.caption('④ 読み取り完了！入力ページで確認・保存');
      await page.waitForTimeout(2800);
    },
  },

  'calendar': {
    path: 'calendar.html',
    mockFirebase: true, // configが要るのでデータ層をmock（DEFAULT_CONFIGベース）
    async run(page, ui) {
      await page.locator('#calGrid .cal-cell:not(.dim)').first().waitFor({ timeout: 15000 });
      const daySel = '#calGrid .cal-cell:not(.dim):not(.actual):not(.today) >> nth=12';
      const day = page.locator('#calGrid .cal-cell:not(.dim):not(.actual):not(.today)').nth(12);
      // 同じ日をタップしていくと 未→JT予定→プレ予定→有給→未 と循環するのを見せる
      await ui.caption('① 日付をタップして出番予定を入れる');
      await ui.ripple(daySel);
      await day.click();                       // → JT予定
      await page.waitForTimeout(1000);
      await ui.caption('② もう一度タップで車種が変わる');
      await day.click();                       // → プレ予定
      await page.waitForTimeout(1100);
      await ui.caption('③ さらにタップで「有給（休み）」になる');
      await ui.ripple(daySel);
      await day.click();                       // → 有給
      await page.waitForTimeout(1300);
      await ui.caption('④ もう一度タップで予定を消す（未に戻る）');
      await ui.ripple(daySel);
      await day.click();                       // → 未（消える）
      await page.waitForTimeout(1300);
      // ⑤ 曜日でまとめて追加
      await page.locator('#dowToggles .dow-toggle').first().scrollIntoViewIfNeeded();
      await ui.caption('⑤ 曜日でまとめて追加（例：金曜）');
      await ui.ripple('#dowToggles .dow-toggle >> nth=5');
      await page.locator('#dowToggles .dow-toggle >> nth=5').click();
      await page.waitForTimeout(1500);
      // ⑥ 月サマリーで確認
      await page.locator('#summary').scrollIntoViewIfNeeded();
      await ui.caption('⑥ 月サマリーで予定数を確認');
      await page.waitForTimeout(2200);
    },
  },

  'arrivals': {
    // 到着便予測ページ（tools/arrivals.html）の使い方。
    // loadArrivals() / loadActuals() / loadEnsemble() を context.route でモックして
    // フライト一覧・予測テーブルが綺麗に表示された状態で操作を見せる。
    path: 'tools/arrivals.html',
    mockArrivals: true,
    async run(page, ui) {
      // 予測セクションとフライト一覧が描画されるのを待つ
      await page.locator('#forecast-table-wrap table').waitFor({ timeout: 15000 });
      await page.locator('#flight-list .flight-row').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      // ① 予測セクション
      await page.evaluate(() => document.getElementById('forecast-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(600);
      await ui.caption('① ここに タクシー出庫の実績／予測 が出る');
      await ui.ripple('#forecast-section');
      await page.waitForTimeout(2400);
      // ② スコープボタンの切替（直近2時間 → 今日全部）
      await ui.caption('② 「直近2時間」「今日全部」で切替');
      await ui.ripple('#forecast-scope-all');
      await page.locator('#forecast-scope-all').click();
      await page.waitForTimeout(1400);
      await ui.ripple('#forecast-scope-recent');
      await page.locator('#forecast-scope-recent').click();
      await page.waitForTimeout(1200);
      // ③ フライト一覧へスクロール
      await page.evaluate(() => document.getElementById('flight-list-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(1000);
      await ui.caption('③ 下にスクロールすると便の一覧');
      await ui.ripple('#flight-list');
      await page.waitForTimeout(2400);
      // ④ 時間帯ヒートマップ
      await page.evaluate(() => document.getElementById('heatmap')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(900);
      await ui.caption('④ 色の濃い時間帯に空港へ行くと乗客が多い');
      await page.waitForTimeout(2600);
    },
  },

  'ic-route': {
    // IC控除距離ページ（tools/ic.html）の使い方。
    // data-loaderが読む data/*.json はローカルサーバから直接配信されるため mockは不要。
    // GPS要求はブラウザ上で「拒否」扱いになるのでGPSバナー/GPS提案は出ない。
    // init() がデフォルト入口=舞浜・出口=霞ヶ関で起動するため、
    // 画面ロード直後から答えカードが表示された状態になる。
    path: 'tools/ic.html',
    async run(page, ui) {
      // 答えカードが描画されるのを待つ（controls が整ったら答えも出ている）
      await page.locator('#answer-body').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(800);

      // ① 画面トップ：入口ICの確認
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(400);
      await ui.caption('① 「どこから乗る？」入口ICを選ぶ');
      await ui.ripple('#step-entry');
      await page.waitForTimeout(1600);

      // ② 入口IC検索（鶴ヶ島を入力して選択）
      await ui.caption('② 別のICを検索（例: 鶴ヶ島）');
      await ui.ripple('#inp-entry-ic');
      // datalistの値を直接入力して change イベントを発火
      await page.locator('#inp-entry-ic').fill('鶴ヶ島IC');
      await page.locator('#inp-entry-ic').dispatchEvent('input');
      await page.locator('#inp-entry-ic').dispatchEvent('change');
      await page.waitForTimeout(1200);

      // ③ 出口ICチップから霞ヶ関を選ぶ
      await page.evaluate(() => document.getElementById('step-exit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(700);
      await ui.caption('③ よく使うICがチップで並んでいる');
      await ui.ripple('#exit-fav-chips');
      await page.waitForTimeout(1800);

      // ④ 霞ヶ関チップをタップ（デフォルトで既に選択済みだが、視覚的に選択アクションを見せる）
      await ui.caption('④ チップをタップして出口ICを選ぶ');
      // 霞ヶ関チップを探してタップ
      const kasumigasekiChip = page.locator('#exit-fav-chips .fav-chip[data-ic-id="kasumigaseki"]');
      const chipExists = await kasumigasekiChip.count();
      if (chipExists > 0) {
        await ui.ripple('#exit-fav-chips .fav-chip[data-ic-id="kasumigaseki"]');
        await kasumigasekiChip.click();
      } else {
        await ui.ripple('#exit-fav-chips .fav-chip');
        await page.locator('#exit-fav-chips .fav-chip').first().click();
      }
      await page.waitForTimeout(1200);

      // ⑤ 答えカードまでスクロールして控除距離を見せる
      await page.evaluate(() => document.getElementById('answer-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(800);
      await ui.caption('⑤ 控除距離が片道・往復で出る');
      await ui.ripple('#answer-body');
      await page.waitForTimeout(2400);

      // ⑥ 今日のログ保存ボタンを見せる
      await ui.caption('「片道だけ保存」で今日のログに追加');
      await ui.ripple('#btn-save-oneway');
      await page.waitForTimeout(2200);
    },
  },

  'timer': {
    // 乗務タイマーページ（tools/index.html）の使い方。
    // addInitScript でページ初回ロード前に localStorage を seed して
    // 乗務開始済み（2時間前出庫・休憩記録1件あり）の状態から録画を始める。
    // breakCountMin=0 にして「記録」ボタンをすぐ有効化する。
    path: 'tools/index.html',
    async run(page, ui) {
      // --- まず localStorage を seed してリロードで状態を反映 ---
      await page.evaluate(() => {
        const now = Date.now();
        const shiftStartAt = now - 2 * 60 * 60 * 1000; // 2時間前に出庫
        // 休憩記録1件（45分前に25分休憩）
        const rec1End = now - 45 * 60 * 1000;
        const rec1 = { recordedAt: new Date(rec1End).toISOString(), durationSec: 25 * 60 };
        const timerState = {
          shiftStart: '07:00',
          records: [rec1],
          runningStartedAt: null,
          targetBreakMin: 180,
          continuousDriveMin: 360,
          shiftStartAt,
          lastResetSnapshot: null,
          breakCountMin: 0, // 録画用: 直後にでも「記録」できるようにする
        };
        localStorage.setItem('taxi-timer-v1', JSON.stringify(timerState));
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.locator('#stopwatch-display').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(600);

      // ① タイマー画面のトップ：乗務開始済み状態を見せる
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(400);
      await ui.caption('① 休憩のスタート・記録ができるタイマー');
      await page.waitForTimeout(2200);

      // ② スタートをタップ（休憩タイマーを開始）
      await ui.caption('② 休憩に入ったら「スタート」をタップ');
      await ui.ripple('#btn-start');
      await page.locator('#btn-start').click();
      await page.waitForTimeout(1800);

      // ③ ストップウォッチが動いているのを見せる
      await ui.caption('③ ストップウォッチが動く。暫定休憩時間も出る');
      await page.waitForTimeout(2600);

      // ④ メトリクスカードへスクロールして帰庫期限・休憩残りを見せる
      await page.evaluate(() => document.querySelector('.metrics')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(800);
      await ui.caption('④ 帰庫期限・残り必要休憩が自動で計算される');
      await ui.ripple('#deadline-card');
      await page.waitForTimeout(2200);
      await ui.ripple('#break-remaining-card');
      await page.waitForTimeout(1800);

      // ⑤ トップに戻って「記録」をタップ（休憩を記録）
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(700);
      await ui.caption('⑤ 休憩が終わったら「記録」をタップ');
      await ui.ripple('#btn-record');
      await page.locator('#btn-record').click();
      await page.waitForTimeout(1600);

      // ⑥ 記録履歴セクションへスクロール
      await page.evaluate(() => document.querySelector('.history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(800);
      await ui.caption('⑥ 記録が履歴に残る。次の可能時刻もわかる');
      await ui.ripple('#history-list');
      await page.waitForTimeout(2400);
    },
  },

  'analysis-view': {
    // 分析ページ(review.html)の「見方」。サンプルデータを流し込んで各カードの数字の読み方を解説。
    path: 'review.html',
    mockFirebase: true,
    sampleData: true,
    async run(page, ui) {
      const scrollTo = (id) => page.evaluate((x) => { const el = document.getElementById(x); if (el) el.scrollIntoView({ block: 'start' }); }, id);
      // チャート描画を待つ（ヒートマップ/ステージが組み上がるまで）
      await page.locator('#heatBody .cell').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await ui.caption('「分析」は“走り方”を見直す画面');
      await page.waitForTimeout(2400);

      // ① 推移グラフ＝売上の流れ
      await page.evaluate(() => document.getElementById('trendCard')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(900);
      await ui.caption('① 推移グラフ＝売上が上がってるか下がってるか');
      await ui.ripple('#trendCard');
      await page.waitForTimeout(2200);

      // ② ヒートマップ：色の濃さ＝稼げた時間帯
      await scrollTo('heatCard');
      await page.waitForTimeout(900);
      await ui.caption('② 色が濃いマス＝あなたが稼げた時間帯');
      await page.waitForTimeout(2600);
      await ui.caption('濃い時間に動く・薄い時間（休憩向き）で休む');
      await page.waitForTimeout(2600);

      // 「稼ぎ時」のマスをタップ → 意味の吹き出しを表示
      const cell = await page.evaluate(() => {
        const c = [...document.querySelectorAll('#heatBody .cell')].find((el) => /稼ぎ時/.test(el.innerHTML));
        if (!c) return null;
        c.scrollIntoView({ block: 'center' });
        const r = c.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (cell) {
        await page.waitForTimeout(400);
        await page.evaluate(([x, y]) => window.__hvRipple(x, y), [cell.x, cell.y]);
        await page.mouse.click(cell.x, cell.y);
        await page.waitForTimeout(600);
        await page.evaluate(() => document.getElementById('heatTip')?.scrollIntoView({ block: 'center' })); // 吹き出しを画面内に
        await page.waitForTimeout(700);
      }
      await ui.caption('③ マスをタップ＝時給と「安定度◎○△」が出る');
      await page.waitForTimeout(2800);
      await ui.caption('◎＝毎回安定して稼げる／△＝日によってムラ大');
      await page.waitForTimeout(2600);

      // ④ ステージ別お手本＝目標額の人の動き方
      await scrollTo('stageCard');
      await page.waitForTimeout(900);
      await ui.caption('④ ステージ別お手本＝目標額の人の動き方');
      await page.waitForTimeout(2600);
      await ui.caption('狙う売上のチップを選ぶと、その日の稼ぎ方が見える');
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
  if (process.env.HV_DUMP) {
    const d = buildSampleData();
    const k = Object.keys(d);
    console.log('periods:', k);
    console.log('counts:', k.map((x) => `${x}=${Array.isArray(d[x]) ? d[x].length : 'NOT-ARRAY'}`).join(' '));
    console.log('sample drive:', JSON.stringify(d[k[k.length - 1]][0], null, 1));
    process.exit(0);
  }
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
      localStorage.setItem('cabis_gps_privacy_dismissed', '1'); // 録画では初回GPSバナーを出さない
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

  // データが要る画面用: Firebase 層を DEFAULT_CONFIG ベースの mock に差し替え（オフラインで描画）。
  if (sc.mockFirebase) {
    const jsHeader = { contentType: 'application/javascript; charset=utf-8' };
    const authStub = `
      export async function initAuth(){}
      export function getUserId(){ return 'demo-help'; }
      export const auth = { currentUser: { uid:'demo-help', getIdToken: async()=>'x' }, authStateReady: async()=>{}, onAuthStateChanged:(cb)=>{ try{cb&&cb({uid:'demo-help'});}catch(e){} return ()=>{}; } };
    `;
    // 分析ページ等、過去データが要る画面はサンプルdriveを注入する。
    const driveData = sc.sampleData ? JSON.stringify(buildSampleData()) : '{}';
    const storageStub = `
      import { DEFAULT_CONFIG } from './default-config.js';
      let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      cfg.shifts = cfg.shifts || {};
      cfg.shifts.expandedDates = cfg.shifts.expandedDates || [];
      cfg.shifts.plannedVehicles = cfg.shifts.plannedVehicles || {};
      cfg.shifts.paidLeaveDates = cfg.shifts.paidLeaveDates || [];
      cfg.shifts.patterns = cfg.shifts.patterns || [];
      ${sc.sampleData ? "cfg.defaults = cfg.defaults || {}; cfg.defaults.vehicleType = 'all'; cfg.defaults.departureTime = '07:00';" : ''}
      const DRIVES = ${driveData};
      export async function getConfig(){ return cfg; }
      export function getConfigCached(){ return cfg; }
      export async function saveConfig(c){ if(c) cfg = c; }
      export async function getDrivesForMonth(ym){ return DRIVES[ym] || []; }
      export function getDrivesForMonthCached(ym){ return DRIVES[ym] || []; } // Cached系は同期（Promiseを返すと呼び側が配列扱いして壊れる）
      export async function getDrive(){ return null; }
      export async function saveDriveSafe(){ }
      export function getMyUserId(){ return 'demo-help'; }
      export function setMyUserId(){ }
      export async function waitForAuth(){ }
    `;
    await context.route('**/js/firebase-auth.js', (r) => r.fulfill({ ...jsHeader, body: authStub }));
    await context.route('**/js/firebase-storage.js', (r) => r.fulfill({ ...jsHeader, body: storageStub }));
  }

  // 到着便ページ用: arrivals.json / stall-actuals.json / stall-ensemble.json をモック。
  // fetch に ?t=... クエリが付くため glob パターンで吸収する。
  if (sc.mockArrivals) {
    const jsonHeader = { contentType: 'application/json; charset=utf-8' };
    await context.route('**/tools/data/arrivals.json**', (r) =>
      r.fulfill({ ...jsonHeader, body: JSON.stringify(buildArrivalsData()) }));
    await context.route('**/tools/data/stall-actuals.json**', (r) =>
      r.fulfill({ ...jsonHeader, body: JSON.stringify(buildArrivalsActuals()) }));
    await context.route('**/tools/data/stall-ensemble.json**', (r) =>
      r.fulfill({ ...jsonHeader, body: JSON.stringify(buildArrivalsEnsemble()) }));
  }

  const page = await context.newPage();
  if (process.env.HV_DEBUG) {
    page.on('console', (m) => console.log('[console]', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message, '\n', e.stack));
    page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
  }
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

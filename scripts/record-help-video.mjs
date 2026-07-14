// 使い方動画レコーダー（案A: 本物の画面を自動操作して録画）
// 本物の input.html / ocr-import.html を Playwright で開き、実際にクリックしながら
// 「タップ波紋＋字幕」を重ねて録画 → ffmpeg で無音・軽量MP4＋サムネに変換する。
//
// playwright はアプリ本体の依存に入れない。グローバル/npx の playwright を NODE_PATH で解決する：
//   1) ローカルサーバを起動:  (cd <worktree> && python3 -m http.server 8782 >/dev/null 2>&1 &)
//   2) 録画:  NODE_PATH="$(npm root -g)" node scripts/record-help-video.mjs <scenario> <out.mp4> [baseUrl]
//      例:    NODE_PATH="$(npm root -g)" node scripts/record-help-video.mjs ocr-import media/help/ocr-import.mp4
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
// 「営業サポート」(support.html) ページ全体 録画用サンプルデータ生成（決定論的）
// support.html は全カード（出庫ペース/次の営業先 推奨検索/曜日×時間¥/h/高期待値エリア/
// 降車エリア別効率）が「全員データ統合」で動く。buildSampleData の時間×金額の濃淡を土台に、
// 各 trip へ実在エリア名の board/alight を割り当て、さらに「千代田区丸の内を20時台に降車→
// 大手町/銀座/六本木で次乗車」のチェーンを仕込んで、推奨検索の結果表が必ず描画されるようにする。
// ============================================================
function buildSupportSampleData() {
  const data = buildSampleData(); // 時間×金額の濃淡（ペース/時給/ヒートマップ用）が土台
  const tm = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
  // 降車エリアを少数のホットエリアに集約（各エリアが5件以上たまり、高期待値/エリア効率が描画される）
  const POOL = ['新宿区新宿', '千代田区丸の内', '中央区銀座', '港区六本木', '渋谷区道玄坂', '品川区港南', '大田区蒲田', '江東区豊洲', '世田谷区桜新町', '目黒区自由が丘'];
  // 丸の内降車後に「次に乗れたエリア」の分布（大手町が多め＝取得率トップに出る）
  const NEXT = [
    { board: '千代田区大手町', wait: 9, drop: '世田谷区桜新町' },
    { board: '千代田区大手町', wait: 11, drop: '目黒区自由が丘' },
    { board: '中央区銀座', wait: 16, drop: '江東区豊洲' },
    { board: '港区六本木', wait: 13, drop: '渋谷区広尾' },
  ];
  const USERS = ['demo-help', 'peer-1', 'peer-2']; // 全員データ統合（自分＋他ドライバー）
  let gi = 0, ni = 0;
  for (const ym of Object.keys(data)) {
    for (const d of data[ym]) {
      const uid = USERS[gi % USERS.length];
      d.userId = uid; d._userId = uid;
      const trips = d.trips || [];
      // まず全 trip に実在エリア名の board/alight を決定論的に割り当て
      for (let i = 0; i < trips.length; i++) {
        trips[i].boardPlace = POOL[(gi + i) % POOL.length] + ((i % 4) + 1);
        trips[i].alightPlace = POOL[(gi + i + 3) % POOL.length] + ((i % 3) + 1);
      }
      // 19〜21時台に降車する trip を「千代田区丸の内」に固定し、その次の trip を NEXT パターンへ
      const ai = trips.findIndex((t) => { const ah = parseInt(t.alightTime.split(':')[0]); return ah >= 19 && ah <= 21; });
      if (ai >= 0 && ai + 1 < trips.length) {
        trips[ai].alightPlace = '千代田区丸の内2';
        const pat = NEXT[ni % NEXT.length]; ni++;
        const dropM = tm(trips[ai].alightTime);
        trips[ai + 1].boardTime = _hhmm(dropM + pat.wait);     // 待ち wait 分（30分以内）
        trips[ai + 1].alightTime = _hhmm(dropM + pat.wait + 25); // 次乗車は25分実車
        trips[ai + 1].boardPlace = pat.board + '8';
        trips[ai + 1].alightPlace = pat.drop + '3';
        if (!(trips[ai + 1].amount > 0)) trips[ai + 1].amount = 5600;
      }
      gi++;
    }
  }
  return data;
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
    // 実データ(tools/data/arrivals.json 等)をローカルサーバからそのまま配信して録画。
    // = 本番(app.taxicabis.com)と同じ見え方にする（架空データのモックは使わない）。
    path: 'tools/arrivals.html',
    mockArrivals: false,
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
    // IC控除距離ページ（tools/ic.html）の使い方（リメイク版）。
    // 1) できること（会社負担/控除距離）→ 2) 入口IC選択 → 3) 出口IC選択→控除距離表示
    // 4) GPS ONで近いIC候補 → 5) プライバシー安心の一言
    // 6) お気に入り長押し並べ替え → 7) ⚙編集からIC追加
    //
    // GPS: geolocation を許可＋東京タワー付近の座標をセット（舞浜より都心に近いICが候補に出る）
    // 長押しドラッグ: pointerdown → wait 500ms → move段階的 → pointerup で並べ替えを見せる
    path: 'tools/ic.html',
    geoPermission: true,  // main()でgeolocationを許可してからページを開く
    async run(page, ui) {
      // 答えカードが描画されるのを待つ（初期値: 入口=舞浜、出口=羽田空港中央）
      await page.locator('#answer-body').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(800);

      // ── ① できること（核心価値）──────────────────────────────────
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(300);
      await ui.caption('① 区域外でも、会社負担の高速か・控除が何kmか一発で分かる');
      await page.waitForTimeout(2800);

      // ── ② 入口ICを選ぶ ───────────────────────────────────────────
      await ui.caption('② 入口ICを選ぶ');
      await ui.ripple('#step-entry');
      await page.waitForTimeout(1400);

      // 入口IC検索: 鶴ヶ島を入力して選択（関越道から乗る例）
      await page.locator('#inp-entry-ic').scrollIntoViewIfNeeded();
      await page.locator('#inp-entry-ic').fill('鶴ヶ島IC');
      await page.locator('#inp-entry-ic').dispatchEvent('input');
      await page.locator('#inp-entry-ic').dispatchEvent('change');
      await page.waitForTimeout(1000);

      // ── ③ 出口ICを選ぶ → 控除距離表示 ──────────────────────────────
      await page.evaluate(() => document.getElementById('step-exit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(600);
      await ui.caption('③ 出口ICを選ぶと控除距離（片道/往復）が出る');
      // 霞ヶ関チップをタップ（デフォルトお気に入り1番目）
      const kasumigasekiChip = page.locator('#exit-fav-chips .fav-chip[data-ic-id="kasumigaseki"]');
      const chipExists = await kasumigasekiChip.count();
      if (chipExists > 0) {
        await ui.ripple('#exit-fav-chips .fav-chip[data-ic-id="kasumigaseki"]');
        await kasumigasekiChip.click();
      } else {
        await ui.ripple('#exit-fav-chips .fav-chip');
        await page.locator('#exit-fav-chips .fav-chip').first().click();
      }
      await page.waitForTimeout(800);

      // 答えカードへスクロールして控除距離を強調
      await page.evaluate(() => document.getElementById('answer-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(600);
      await ui.ripple('#answer-body');
      await page.waitForTimeout(2200);

      // ── ④ GPS ONで近いIC候補 ─────────────────────────────────────
      // GPS は既に許可済み（geoPermission:true）+ 座標セット済み。
      // ページロード時に位置情報が取得されて geo-suggest が表示されているはず。
      // 見えていなければ「再取得」を押す。
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(400);

      const geoSuggestVisible = await page.locator('#geo-suggest').isVisible().catch(() => false);
      if (!geoSuggestVisible) {
        // 再取得ボタンを押してGPSを起動
        await page.locator('#btn-geo-refresh').click();
        await page.waitForTimeout(1200);
      }

      await ui.caption('④ GPSをONにすると近くのICが候補に出て入力がラク');
      await ui.ripple('#geo-suggest');
      await page.waitForTimeout(2400);

      // ── ⑤ プライバシー安心の一言 ─────────────────────────────────
      await ui.caption('⑤ GPSは近くのIC探しだけに使用。場所がサーバーに送られる等の心配はありません');
      await page.waitForTimeout(3000);

      // ── ⑥ お気に入り長押し並べ替え ──────────────────────────────
      await page.evaluate(() => document.getElementById('step-exit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(600);
      await ui.caption('⑥ お気に入りは長押しで並べ替え');

      // 1番目チップ（霞ヶ関）を長押しして2番目チップ（外苑）の位置へドラッグ
      const chip0 = page.locator('#exit-fav-chips .fav-chip[data-ic-id]').nth(0);
      const chip1 = page.locator('#exit-fav-chips .fav-chip[data-ic-id]').nth(1);
      const box0 = await chip0.boundingBox();
      const box1 = await chip1.boundingBox();

      if (box0 && box1) {
        const cx0 = box0.x + box0.width / 2;
        const cy0 = box0.y + box0.height / 2;
        const cx1 = box1.x + box1.width / 2;
        const cy1 = box1.y + box1.height / 2;

        // pointerdown で長押し開始（0.5秒保持で beginExitDrag 発火）
        await page.mouse.move(cx0, cy0);
        await page.mouse.down();
        // 長押しタイマーは450ms。600ms待って確実に発火させる
        await page.waitForTimeout(600);
        // 段階的にドラッグして隣のチップの位置へ移動
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.mouse.move(
            cx0 + (cx1 - cx0) * t,
            cy0 + (cy1 - cy0) * t,
            { steps: 1 }
          );
          await page.waitForTimeout(60);
        }
        await page.waitForTimeout(400);
        await page.mouse.up();
        await page.waitForTimeout(600);
      } else {
        await page.waitForTimeout(1200);
      }
      await page.waitForTimeout(1200);

      // ── ⑦ ⚙編集からIC追加 ───────────────────────────────────────
      await ui.caption('⑥ ⚙編集から追加もできる');
      await ui.ripple('#btn-exit-edit');
      await page.locator('#btn-exit-edit').click();
      await page.waitForTimeout(800);

      // 編集モードになったことを確認。IC検索フィールドに入力して追加
      // 検索値は datalist の表示名と完全一致が必要（search.js buildSearchEntries が生成する形式）
      await page.locator('#inp-exit-ic').scrollIntoViewIfNeeded();
      await page.locator('#inp-exit-ic').fill('渋谷');
      await page.locator('#inp-exit-ic').dispatchEvent('input');
      await page.locator('#inp-exit-ic').dispatchEvent('change');
      await page.waitForTimeout(800);

      // ✓完了ボタンで編集終了
      await ui.ripple('#btn-exit-edit');
      await page.locator('#btn-exit-edit').click();
      await page.waitForTimeout(1400);
    },
  },

  'timer': {
    // 乗務タイマーページ（tools/index.html）の使い方。
    // addInitScript でページ初回ロード前に localStorage を seed して
    // 乗務開始済み（2時間前出庫・休憩記録1件あり）の状態から録画を始める。
    // breakCountMin=0 にして「記録」ボタンをすぐ有効化する。
    path: 'tools/index.html',
    seedTimer: true, // 初回ロード前にaddInitScriptでseed済み＝乗務開始済み状態で即描画（謎の間なし）
    async run(page, ui) {
      await page.locator('#stopwatch-display').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);

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

      // ④ メトリクスカードへスクロールして連続走行可能時間・休憩残りを見せる
      await page.evaluate(() => document.querySelector('.metrics')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(800);
      await ui.caption('④ 連続走行可能時間・残り必要休憩が自動で計算される');
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

      // ⑦ 設定を開いて「連続走行可能時間」「必要休憩」が変更できることを見せる
      await page.evaluate(() => document.querySelector('#settings-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await page.waitForTimeout(500);
      await ui.ripple('#btn-settings-toggle');
      await page.locator('#btn-settings-toggle').click();
      await page.waitForTimeout(900);
      await page.evaluate(() => document.querySelector('#continuous-drive-hour')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(600);
      await ui.caption('⑦ 連続走行可能時間・必要休憩は設定で変えられる');
      await ui.ripple('#continuous-drive-hour');
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

  'sales-support': {
    // 営業サポート(support.html)ページ全体の見方ツアー。全員データ統合のサンプルを流し込む。
    path: 'support.html',
    mockFirebase: true,
    supportSample: true,
    async run(page, ui) {
      const scrollTo = (id) => page.evaluate((x) => document.getElementById(x)?.scrollIntoView({ block: 'start' }), id);
      // 推奨カードのプルダウンが埋まる＝データ反映完了を待つ（option は closed select 内で hidden 扱いなので attached を待つ）
      await page.locator('#recArea option').first().waitFor({ state: 'attached', timeout: 15000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await ui.caption('「営業サポート」＝次にどこへ行けば稼げるかを全員データで提案する画面');
      await page.waitForTimeout(2800);

      // ① 出庫ペース（録画時刻に依存せず数字が出るよう、全曜日＋経過8時間時点に切替）
      await scrollTo('paceCard');
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const dall = document.querySelector('#paceCard .pace-dtab[data-d=""]'); if (dall) dall.click();
        const e8 = [...document.querySelectorAll('#paceCard .pace-etab')].find((b) => b.textContent.trim() === '8h'); if (e8) e8.click();
      });
      await page.waitForTimeout(700);
      await ui.caption('① 出庫ペース＝今の累積営収が平均より速いか遅いか');
      await ui.ripple('#paceCard');
      await page.waitForTimeout(2600);

      // ② 次の営業先 推奨検索（実演）
      await scrollTo('recommendCard');
      await page.waitForTimeout(800);
      await ui.caption('② 次の営業先 推奨検索＝降ろした場所×時刻 → 次に取れるエリア');
      await page.waitForTimeout(2600);
      await ui.caption('降ろした場所を選ぶ');
      await ui.ripple('#recArea');
      await page.selectOption('#recArea', '千代田区丸の内');
      await page.waitForTimeout(1400);
      await ui.caption('降ろした時刻を入れて「推奨を表示」をタップ');
      await page.evaluate(() => { const t = document.getElementById('recTime'); if (t) t.value = '20:00'; });
      await ui.ripple('#recSearch');
      await page.click('#recSearch');
      await page.locator('#recBody table').first().waitFor({ timeout: 8000 });
      await page.evaluate(() => document.getElementById('recBody')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(1600);
      await ui.caption('「30分内」が高い順＝次の仕事が見つかりやすいエリア');
      await page.waitForTimeout(2800);
      await ui.caption('「次運賃」＝次に取れた乗車の単価。行をタップで根拠の履歴も見られる');
      await page.waitForTimeout(2800);
      // GPS ボタンの紹介（プライバシー注記つき・タップはしない）
      await page.evaluate(() => document.getElementById('recGps')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await ui.caption('📍現在地から自動入力＝GPSで降ろし場所をセット（場所はサーバーに送られません）');
      await ui.ripple('#recGps');
      await page.waitForTimeout(2800);

      // ③ 曜日×時間の時給
      await scrollTo('hourEffCard');
      await page.waitForTimeout(800);
      await ui.caption('③ 曜日×時間の時給＝自分が稼げている時間帯（高い時間に動く）');
      await ui.ripple('#hourEffCard');
      await page.waitForTimeout(2800);

      // ④ 高期待値エリア×時間帯
      await scrollTo('highValueCard');
      await page.waitForTimeout(800);
      await ui.caption('④ 高期待値エリア×時間帯＝単価が大きく出る場所と時間');
      await ui.ripple('#highValueCard');
      await page.waitForTimeout(2800);

      // ⑤ 降車エリア別 効率
      await scrollTo('areaCard');
      await page.waitForTimeout(800);
      await ui.caption('⑤ 降車エリア別 効率＝降ろした後の動きやすさ（単価・待ち時間）');
      await ui.ripple('#areaCard');
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
  // セレクタから「描画する瞬間」に座標を計算（getBoundingClientRect=ビューポート座標）。波紋ズレ防止。
  window.__hvRippleSel = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const b = el.getBoundingClientRect();
    window.__hvRipple(b.left + b.width / 2, b.top + b.height / 2);
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

  // GPS対応シナリオ: geolocation 許可＋東京タワー付近の座標（35.6585, 139.7454）を設定
  // → 都心に近いIC（霞ヶ関・外苑など）が GPS 候補に出る
  const contextOptions = {
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  };
  if (sc.geoPermission) {
    contextOptions.permissions = ['geolocation'];
    contextOptions.geolocation = { latitude: 35.6585, longitude: 139.7454 };
  }
  const context = await browser.newContext(contextOptions);
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

  // タイマー: 初回ロード前に localStorage を seed（reload/乗務未開始フラッシュなし＝謎の間を解消）
  if (sc.seedTimer) {
    await context.addInitScript(() => {
      const now = Date.now();
      const shiftStartAt = now - 2 * 60 * 60 * 1000;
      const rec1End = now - 45 * 60 * 1000;
      localStorage.setItem('taxi-timer-v1', JSON.stringify({
        shiftStart: '07:00',
        records: [{ recordedAt: new Date(rec1End).toISOString(), durationSec: 25 * 60 }],
        runningStartedAt: null, targetBreakMin: 180, continuousDriveMin: 360,
        shiftStartAt, lastResetSnapshot: null, breakCountMin: 0,
      }));
    });
  }

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
    // support.html（営業サポート全体）は「全員データ統合」なので buildSupportSampleData を使い、
    //   全員データ＝全drive / 自分データ＝demo-help分 を返し分ける。
    const wantsData = sc.sampleData || sc.supportSample;
    const driveData = sc.supportSample
      ? JSON.stringify(buildSupportSampleData())
      : (sc.sampleData ? JSON.stringify(buildSampleData()) : '{}');
    const storageStub = `
      import { DEFAULT_CONFIG } from './default-config.js';
      let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      cfg.shifts = cfg.shifts || {};
      cfg.shifts.expandedDates = cfg.shifts.expandedDates || [];
      cfg.shifts.plannedVehicles = cfg.shifts.plannedVehicles || {};
      cfg.shifts.paidLeaveDates = cfg.shifts.paidLeaveDates || [];
      cfg.shifts.patterns = cfg.shifts.patterns || [];
      ${wantsData ? "cfg.defaults = cfg.defaults || {}; cfg.defaults.vehicleType = 'all'; cfg.defaults.departureTime = '07:00';" : ''}
      const DRIVES = ${driveData};
      const SUPPORT = ${sc.supportSample ? 'true' : 'false'};
      const monthAll = (ym) => DRIVES[ym] || [];
      const monthMine = (ym) => SUPPORT ? (DRIVES[ym] || []).filter(d => (d._userId || d.userId) === 'demo-help') : (DRIVES[ym] || []);
      export async function getConfig(){ return cfg; }
      export function getConfigCached(){ return cfg; }
      export async function saveConfig(c){ if(c) cfg = c; }
      export async function getDrivesForMonth(ym){ return monthMine(ym); }
      export function getDrivesForMonthCached(ym){ return monthMine(ym); } // Cached系は同期（Promiseを返すと呼び側が配列扱いして壊れる）
      export async function getAllUsersDrivesForMonth(ym){ return monthAll(ym); }
      export function getAllUsersDrivesForMonthCached(ym){ return monthAll(ym); }
      export async function listActiveUserIds(){ return ${sc.supportSample ? "['demo-help','peer-1','peer-2']" : '[]'}; }
      export function listActiveUserIdsCached(){ return ${sc.supportSample ? "['demo-help','peer-1','peer-2']" : '[]'}; }
      export async function getUserRoleMap(){ return {}; }
      export function getUserRoleMapCached(){ return {}; }
      export async function getMyAggregateAnalysisFlag(){ return true; }
      export async function getMyConsecutiveShiftsCount(){ return 30; }
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
      // 描画の瞬間にブラウザ内で getBoundingClientRect から座標計算＝スクロール/タイミングに関係なく必ず合う
      await page.evaluate((s) => window.__hvRippleSel(s), sel);
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

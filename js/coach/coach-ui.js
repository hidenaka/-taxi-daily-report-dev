import { renderBottomNav, todayIso, currentBillingPeriod } from '../app.js';
import { getConfig, getDrivesForMonth } from '../storage.js';
import { enforceAccess } from '../access-control.js';
import { calcDailySales } from '../payroll.js';
import { showGpsPrivacyBanner } from '../gps-privacy-banner.js';
import { goalKeyFor, interpretDailyGoal, buildContext } from './coach-context.js';
import { runCoach } from './coach-run.js';

// --- アクセスゲート ---
if (!(await enforceAccess('analysis'))) {
  throw new Error('access-denied: redirected');
}

// --- ナビゲーション + GPSバナー ---
document.getElementById('navHost').innerHTML = renderBottomNav('tools');
showGpsPrivacyBanner();

// --- データ初期化 ---
const config = await getConfig();
const vehicleType = config?.defaults?.vehicleType || 'japantaxi';
const today = todayIso();
const drives = await getDrivesForMonth(currentBillingPeriod());
const todayDrive = drives.find(d => d.date === today) || null;
const todaySales = todayDrive ? calcDailySales(todayDrive).inclTax : 0;

// --- 目標管理 ---
function loadGoal() {
  return interpretDailyGoal(localStorage.getItem(goalKeyFor(today)));
}

function saveGoal(g) {
  localStorage.setItem(goalKeyFor(today), JSON.stringify(g));
}

// --- 目標UI ---
function renderGoalDisplay() {
  const goal = loadGoal();
  const displayEl = document.getElementById('goalDisplay');
  const formEl = document.getElementById('goalForm');

  if (goal) {
    let text;
    if (goal.type === 'money') {
      text = `目標金額: ¥${goal.targetYen.toLocaleString('ja-JP')}`;
    } else {
      const h = Math.floor(goal.targetReturnMin / 60);
      const m = goal.targetReturnMin % 60;
      text = `帰宅目標: ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      if (goal.targetYen) text += ` (¥${goal.targetYen.toLocaleString('ja-JP')} 以上)`;
    }
    displayEl.innerHTML = `
      <div class="goal-display">${text}</div>
      <span class="goal-edit-link" id="goalEditLink">変更する</span>
    `;
    formEl.style.display = 'none';
    document.getElementById('goalEditLink').addEventListener('click', () => {
      formEl.style.display = '';
      displayEl.innerHTML = '';
    });
  } else {
    displayEl.innerHTML = '<p style="font-size:12px;color:var(--muted);margin:0 0 8px;">目標を設定すると、より具体的なアドバイスができます。</p>';
    formEl.style.display = '';
  }
}

// 目標タイプ切替
const radioMoney = document.querySelector('input[name="goalType"][value="money"]');
const radioTime = document.querySelector('input[name="goalType"][value="time"]');
const goalMoneyInput = document.getElementById('goalMoney');
const goalTimeInput = document.getElementById('goalTime');

function updateGoalInputVisibility() {
  if (radioMoney.checked) {
    goalMoneyInput.style.display = 'block';
    goalTimeInput.style.display = 'none';
  } else {
    goalMoneyInput.style.display = 'none';
    goalTimeInput.style.display = 'block';
  }
}

radioMoney.addEventListener('change', updateGoalInputVisibility);
radioTime.addEventListener('change', updateGoalInputVisibility);
updateGoalInputVisibility();

document.getElementById('goalSaveBtn').addEventListener('click', () => {
  if (radioMoney.checked) {
    const yen = parseInt(goalMoneyInput.value, 10);
    if (!yen || yen <= 0) { goalMoneyInput.focus(); return; }
    saveGoal({ type: 'money', targetYen: yen });
  } else {
    const val = goalTimeInput.value; // "HH:MM"
    if (!val) { goalTimeInput.focus(); return; }
    const [h, m] = val.split(':').map(Number);
    const targetReturnMin = h * 60 + m;
    saveGoal({ type: 'time', targetReturnMin });
  }
  renderGoalDisplay();
});

renderGoalDisplay();

// --- GPS取得 ---
// support.html の runGpsLookup と同等のコアロジック
// MUNI_FALLBACK は support.html と完全同期 (東京23区+三多摩+横浜18区+川崎7区)
const MUNI_FALLBACK = {
  '13101':'千代田区','13102':'中央区','13103':'港区','13104':'新宿区','13105':'文京区',
  '13106':'台東区','13107':'墨田区','13108':'江東区','13109':'品川区','13110':'目黒区',
  '13111':'大田区','13112':'世田谷区','13113':'渋谷区','13114':'中野区','13115':'杉並区',
  '13116':'豊島区','13117':'北区','13118':'荒川区','13119':'板橋区','13120':'練馬区',
  '13121':'足立区','13122':'葛飾区','13123':'江戸川区',
  '13201':'八王子市','13202':'立川市','13203':'武蔵野市','13204':'三鷹市','13208':'青梅市',
  '13209':'府中市','13211':'調布市','13212':'町田市','13219':'狛江市',
  '14130':'横浜市鶴見区','14131':'横浜市神奈川区','14132':'横浜市西区','14133':'横浜市中区',
  '14134':'横浜市南区','14135':'横浜市保土ケ谷区','14136':'横浜市磯子区','14137':'横浜市金沢区',
  '14138':'横浜市港北区','14139':'横浜市戸塚区','14140':'横浜市港南区','14141':'横浜市旭区',
  '14142':'横浜市緑区','14143':'横浜市瀬谷区','14144':'横浜市栄区','14145':'横浜市泉区',
  '14146':'横浜市青葉区','14147':'横浜市都筑区',
  '14150':'川崎市川崎区','14151':'川崎市幸区','14152':'川崎市中原区','14153':'川崎市高津区',
  '14154':'川崎市多摩区','14155':'川崎市宮前区','14156':'川崎市麻生区',
};

let currentPlace = '';

async function runGpsLookup() {
  const btn = document.getElementById('gpsBtn');
  const status = document.getElementById('areaStatus');

  if (!navigator.geolocation) {
    status.textContent = 'このブラウザは位置情報非対応';
    return;
  }

  btn.disabled = true;
  btn.textContent = '📍 取得中…';
  status.textContent = '位置情報取得中…';

  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true })
    );
    const { latitude: lat, longitude: lon } = pos.coords;
    status.textContent = '町名取得中…';

    const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`);
    const data = await res.json();

    if (!data.results) {
      status.textContent = '町名取得失敗';
      currentPlace = '';
      return;
    }

    const muniCd = data.results.muniCd;
    const lv01Nm = data.results.lv01Nm;
    let muniName = MUNI_FALLBACK[muniCd] || '';

    if (!muniName) {
      try {
        const muniRes = await fetch('https://maps.gsi.go.jp/js/muni.js');
        const muniText = await muniRes.text();
        const match = muniText.match(new RegExp(`'${muniCd}',[^']*'([^']+)'`));
        if (match) muniName = match[1].split(',').pop();
      } catch (e) { /* フォールバック失敗は無視 */ }
    }

    currentPlace = (muniName + (lv01Nm || '')).trim();
    status.textContent = currentPlace ? `📍 ${currentPlace}` : '(場所を特定できませんでした)';
  } catch (err) {
    status.textContent = '取得エラー: ' + (err.message || String(err.code || err));
    currentPlace = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '📍 現在地を取得';
  }
}

document.getElementById('gpsBtn').addEventListener('click', runGpsLookup);

// --- 回答表示 ---
function renderAnswer(lines) {
  const answerEl = document.getElementById('answer');
  const answerCard = document.getElementById('answerCard');
  answerEl.innerHTML = '';
  if (!lines || lines.length === 0) {
    answerEl.innerHTML = '<p class="muted" style="font-size:12px;">回答を生成できませんでした。</p>';
    answerCard.style.display = '';
    return;
  }
  lines.forEach(line => {
    const div = document.createElement('div');
    div.className = 'coach-msg';
    div.textContent = line;
    answerEl.appendChild(div);
  });
  answerCard.style.display = '';
  answerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- チップクリック ---
document.getElementById('chips').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-intent]');
  if (!btn) return;

  const intent = btn.dataset.intent;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const ctx = buildContext(today, nowMin, currentPlace, vehicleType);
  const goal = loadGoal();
  const { lines } = runCoach({ drives, todaySales, ctx, goal, intent });
  renderAnswer(lines);
});

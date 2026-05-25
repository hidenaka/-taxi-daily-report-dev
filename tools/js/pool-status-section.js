// タクシープール現況セクション。pool-status.json と カメラサムネを描画する。
// taxi-ic-helper → relay → tools/data/ に配信されたデータを読む。
const LEVEL_JA = { empty: '空き', normal: '普通', crowded: '混雑', full: '満車' };
const LEVEL_DOTS = { empty: '●○○○', normal: '●●○○', crowded: '●●●○', full: '●●●●' };
const STALE_MINUTES = 30;

export function levelText(level) { return LEVEL_JA[level] || '—'; }
export function levelDots(level) { return LEVEL_DOTS[level] || '○○○○'; }
export function activityText(act) {
  if (!act) return '—';
  const label = { active: '活発', normal: '平常', low: '少なめ' }[act.level] || '—';
  const arrow = { up: '↑', flat: '→', down: '↓' }[act.arrow] || '';
  return `${label}${arrow}`;
}
export function isStale(generatedAt, nowMs, maxMinutes = STALE_MINUTES) {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return (nowMs - t) > maxMinutes * 60 * 1000;
}

export async function loadPoolStatus(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/pool-status.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

export async function initPoolStatusSection() {
  const metaEl = document.getElementById('pool-status-meta');
  const occEl = document.getElementById('pool-status-occ');
  const actEl = document.getElementById('pool-status-activity');
  const img1 = document.getElementById('pool-cam-real01');
  const img2 = document.getElementById('pool-cam-real02');
  if (!metaEl || !occEl) return;

  async function render() {
    const cb = Date.now();
    if (img1) img1.src = `data/pool-cam-real01.jpg?t=${cb}`;
    if (img2) img2.src = `data/pool-cam-real02.jpg?t=${cb}`;
    const { data, error } = await loadPoolStatus();
    if (error || !data) { metaEl.textContent = '現況データを取得できていません'; return; }
    if (isStale(data.generatedAt, Date.now())) {
      metaEl.textContent = '現況データが配信停止中の可能性があります';
    } else {
      const ts = String(data.generatedAt).slice(11, 16);
      metaEl.textContent = `直近 ${ts} 時点`;
    }
    const t = data.total || {};
    occEl.innerHTML = `混み具合: <span class="ps-dots">${levelDots(t.level)}</span> ${levelText(t.level)}（在台 約${t.occ ?? '—'}台）`;
    if (actEl) {
      const a = data.activity || {};
      actEl.innerHTML = `今日の流れ: <strong>${activityText(a)}</strong>（直近1h 出庫${a.recent1hDepartures ?? '—'}台 / 平常${a.typical1h ?? '—'}台）`;
    }
  }
  await render();
  return render;
}

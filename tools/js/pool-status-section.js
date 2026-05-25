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
const TREND_JA = { up: '活発↑', flat: '横ばい→', down: '少なめ↓' };

export function waitText(waitMin) {
  return (typeof waitMin === 'number') ? `約${waitMin}分` : '—';
}
export function trendText(trend) { return TREND_JA[trend] || '—'; }

/** 1乗り場分の事実行を組み立てる（断定しない・目安語彙のみ）。 */
export function formatStallLine(stall) {
  if (!stall) return '';
  return `${stall.label}：在台 約${stall.occ ?? '—'}台 ／ 待ち目安 ${waitText(stall.waitMin)} ／ 出 ${trendText(stall.trend)}`;
}

const TERMINAL_LABEL = { T1: '第1・2乗り場（JAL T1）', T2: '第3・4乗り場（ANA T2）' };

/** terminalArrivals を T1→T2 の順で人が読める行配列に。null/欠落は空配列。 */
export function formatTerminalArrivals(ta) {
  if (!ta) return [];
  const out = [];
  for (const t of ['T1', 'T2']) {
    const v = ta[t];
    if (!v) continue;
    out.push(`${TERMINAL_LABEL[t]}これから来る客：30分で約${v.next30 ?? 0}人 ／ 60分で約${v.next60 ?? 0}人`);
  }
  return out;
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
  const stallsEl = document.getElementById('pool-status-stalls');
  const arrivalsEl = document.getElementById('pool-status-arrivals');
  if (!metaEl || !occEl) return;

  async function render() {
    const cb = Date.now();
    if (img1) img1.src = `data/pool-cam-real01.jpg?t=${cb}`;
    if (img2) img2.src = `data/pool-cam-real02.jpg?t=${cb}`;
    const { data, error } = await loadPoolStatus();
    if (error || !data) { metaEl.textContent = '現況データを取得できていません'; return; }
    const ts = String(data.generatedAt).slice(11, 16);
    if (isStale(data.generatedAt, Date.now())) {
      metaEl.textContent = `📷 配信停止中の可能性（写真・データは ${ts} が最終）`;
    } else {
      metaEl.textContent = `📷 写真・データは ${ts} 時点（数分ごと更新・リアルタイムではありません）`;
    }
    const t = data.total || {};
    occEl.innerHTML = `混み具合: <span class="ps-dots">${levelDots(t.level)}</span> ${levelText(t.level)}（在台 約${t.occ ?? '—'}台）`;
    if (actEl) {
      const a = data.activity || {};
      actEl.innerHTML = `今日の流れ: <strong>${activityText(a)}</strong>（直近1h 出庫${a.recent1hDepartures ?? '—'}台 / 平常${a.typical1h ?? '—'}台）`;
    }
    if (stallsEl) {
      const stalls = data.stalls;
      if (stalls) {
        const order = ['stall1', 'stall2', 'stall3', 'stall4'];
        stallsEl.innerHTML = order
          .filter(k => stalls[k])
          .map(k => `<div>${formatStallLine(stalls[k])}</div>`)
          .join('');
      } else {
        stallsEl.innerHTML = '';
      }
    }
    if (arrivalsEl) {
      const lines = formatTerminalArrivals(data.terminalArrivals);
      arrivalsEl.innerHTML = lines.length
        ? lines.map(l => `<div>${l}</div>`).join('')
        : '';
    }
  }
  await render();
  return render;
}

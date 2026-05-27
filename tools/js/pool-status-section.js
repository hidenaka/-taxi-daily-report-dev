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

const ARROW_JA = { up: '↑', flat: '→', down: '↓' };

/** activity から「いつもより活発→ （火曜平日 同時間帯比 +13%）」形式の1行を構築。
 * sameConditionCompare が無い/サンプル不足のときは活発度（active/normal/low + arrow）のみ。 */
export function formatActivityLine(activity) {
  if (!activity) return '—';
  const arrow = ARROW_JA[activity.arrow] || '';
  const sc = activity.sameConditionCompare;
  if (sc && typeof sc.percent === 'number' && sc.label) {
    const pct = Math.round(sc.percent);
    const sign = pct >= 0 ? '+' : '';
    return `${sc.label}${arrow} （${sc.dayLabel} 同時間帯比 ${sign}${pct}%）`;
  }
  const activeLabel = { active: '活発', normal: '平常', low: '少なめ' }[activity.level] || '—';
  if (sc && sc.dayLabel) {
    return `${activeLabel}${arrow} （${sc.dayLabel} 同時間帯のサンプル不足）`;
  }
  return `${activeLabel}${arrow}`;
}

const RANK_HINT_JA = {
  'most-active': '最も動き活発',
  'most-low': '最も動き少なめ',
};

/** 乗り場1行（V2: trend + rankHint + 同条件過去比較）。
 *  rankHint × sameConditionCompare.percent の有無で6パターン分岐。 */
export function formatStallLineV2(stall) {
  if (!stall) return '';
  const trend = stall.trend ? trendText(stall.trend) : '—';
  const hint = stall.rankHint ? RANK_HINT_JA[stall.rankHint] : null;
  const sc = stall.sameConditionCompare;
  const hasPercent = sc && typeof sc.percent === 'number';
  // percent の符号付き表記
  const pctText = hasPercent
    ? `いつもの ${sc.percent >= 0 ? '+' : ''}${Math.round(sc.percent)}%`
    : null;

  let tail = '';
  if (hint && pctText) tail = ` ← ${hint}（${pctText}）`;
  else if (hint) tail = ` ← ${hint}`;
  else if (pctText) tail = `（${pctText}）`;

  return `${stall.label}  ${trend}${tail}`;
}

const TERMINAL_HEAD = { T1: 'T1ターミナル', T2: 'T2ターミナル' };

/** 「分」を2桁ゼロ埋めの文字列に。負値は0扱い。 */
function minutesText(min) {
  const m = Math.max(0, min | 0);
  return `あと${String(m).padStart(2, '0')}分`;
}

/** 全角文字を2幅、ASCII を1幅として文字列の表示幅を返す。 */
function displayWidth(s) {
  return [...s].reduce((w, c) => w + (c.codePointAt(0) > 0x7f ? 2 : 1), 0);
}

/** 表示幅ベースの padEnd（全角対応）。 */
function padEndDisplay(s, targetWidth) {
  return s + ' '.repeat(Math.max(0, targetWidth - displayWidth(s)));
}

/** terminalArrivalsList を「T1 (JAL) / あとN分 便名 fromから N席」の行配列に。 */
export function formatArrivalsList(list) {
  if (!list) return [];
  const lines = [];
  for (const t of ['T1', 'T2']) {
    const arr = list[t] || [];
    if (arr.length === 0) continue;
    lines.push(TERMINAL_HEAD[t]);
    for (const f of arr) {
      const fromField = padEndDisplay(`${f.fromName}から`, 13);
      lines.push(`  ${minutesText(f.lobbyExitMinutes)}  ${f.flightNumber}  ${fromField}${f.seatCount}席`);
    }
  }
  return lines;
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
  const actEl = document.getElementById('pool-status-activity');
  const img1 = document.getElementById('pool-cam-real01');
  const img2 = document.getElementById('pool-cam-real02');
  const stallsEl = document.getElementById('pool-status-stalls');
  const arrivalsEl = document.getElementById('pool-status-arrivals');
  if (!metaEl) return;

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
      metaEl.textContent = `📷 ${ts}時点（カメラ推定で実数とズレあり）`;
    }
    if (actEl) {
      actEl.innerHTML = `<strong>今日の流れ</strong> ${formatActivityLine(data.activity || {})}`;
    }
    if (stallsEl) {
      const stalls = data.stalls;
      if (stalls) {
        const order = ['stall1', 'stall2', 'stall3', 'stall4'];
        const head = '<div style="color:var(--sub); font-size:11px; margin-bottom:4px;">乗り場の動き</div>';
        stallsEl.innerHTML = head + order
          .filter(k => stalls[k])
          .map(k => `<div>${formatStallLineV2(stalls[k])}</div>`)
          .join('');
      } else {
        stallsEl.innerHTML = '';
      }
    }
    if (arrivalsEl) {
      const lines = formatArrivalsList(data.terminalArrivalsList);
      if (lines.length) {
        const head = '<div style="color:var(--sub); font-size:12px; margin-top:8px; margin-bottom:4px;">✈ これからお客がロビーに出る便（運航データ・予測ではない）</div>';
        arrivalsEl.innerHTML = head + lines
          .map(l => l.startsWith('  ') ? `<div style="padding-left:8px;">${l.trimStart()}</div>` : `<div style="font-weight:600; margin-top:4px;">${l}</div>`)
          .join('');
      } else {
        arrivalsEl.innerHTML = '';
      }
    }
  }
  await render();
  return render;
}

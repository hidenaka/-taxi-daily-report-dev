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
  return `${activeLabel}${arrow}`;
}

// 出庫の勢いを段階バー(●○)で表す。直近1時間の出庫台数を 1ドット≒DOT_PER台 で 0〜5段階に。
// 4乗り場を同じ物差しで並べるので、一目でどこが出てるか比較できる。
const BAR_LEN = 5;
const DOT_PER = 4; // 1ドット ≒ 4台/時
export function activityBar(dep) {
  if (typeof dep !== 'number' || dep < 0) return null;
  const filled = dep <= 0 ? 0 : Math.min(BAR_LEN, Math.max(1, Math.round(dep / DOT_PER)));
  return '●'.repeat(filled) + '○'.repeat(BAR_LEN - filled);
}

/** 乗り場1行（V2: 直近1時間の出庫台数を段階バー＋実数で。普段比はカッコで別語彙で添える）。
 *  旧版は「普段比(活発/少なめ)」と「順位(最も動き活発/少なめ)」を同じ語彙で並べて矛盾に見え、
 *  さらに中間の乗り場が全部「ふつう」で段階が出なかった。出庫台数のバーで4乗り場を等しく段階表示する。 */
export function formatStallLineV2(stall) {
  if (!stall) return '';
  const bar = activityBar(stall.recent1hDep);
  if (bar === null) return `${stall.label}  —`; // 出庫台数の観測なし

  // カッコ＝普段との比較。percent があれば数字、無ければ trend を別語彙(多め/静か)で。flat/不明は付けない。
  const sc = stall.sameConditionCompare;
  let note = '';
  if (sc && typeof sc.percent === 'number') {
    note = `（いつもの ${sc.percent >= 0 ? '+' : ''}${Math.round(sc.percent)}%）`;
  } else if (stall.trend === 'up') {
    note = '（普段より多め）';
  } else if (stall.trend === 'down') {
    note = '（普段より静か）';
  }

  return `${stall.label}  ${bar}  ${String(stall.recent1hDep).padStart(2)}台${note}`;
}

const TERMINAL_HEAD = { T1: 'T1ターミナル', T2: 'T2ターミナル' };
const NORIBA_HEAD = { 1: '1号（T1 南）', 2: '2号（T1 北）', 3: '3号（T2 北）', 4: '4号（T2 南・国際）' };

/** 定員表示。null/0/不明は「席数不明」。乗務員が客の規模を掴みやすい「人乗り」。 */
function seatText(s) { return (typeof s === 'number' && s > 0) ? `${s}人乗り` : '席数不明'; }

/** 「あと◯分」。ゼロ埋めしない(あと2分)。負値は0扱い。 */
function minutesText(min) {
  const m = Math.max(0, min | 0);
  return `あと${m}分`;
}

// 便1行: 「あと◯分 / どこから / 定員」だけ。便名は乗務員に不要なノイズなので出さない。
function arrivalLine(f) {
  return `  ${minutesText(f.lobbyExitMinutes)}  ${f.fromName ?? ''}から  ${seatText(f.seatCount)}`;
}

/** 到着便リストを行配列に。noribaList(号別 1-4)があれば号別に、無ければ terminalList(T1/T2)に。
 * 後方互換: 第1引数に {T1,T2} を渡す旧呼び出しも terminal 表示として動く。 */
export function formatArrivalsList(noribaList, terminalList) {
  const hasNoriba = noribaList && [1, 2, 3, 4].some(n => Array.isArray(noribaList[n]) && noribaList[n].length);
  const lines = [];
  if (hasNoriba) {
    for (const n of [1, 2, 3, 4]) {
      const arr = noribaList[n] || [];
      if (arr.length === 0) continue;
      lines.push(NORIBA_HEAD[n]);
      for (const f of arr) lines.push(arrivalLine(f));
    }
    return lines;
  }
  // フォールバック: 号別データが無ければ従来の T1/T2 表示。
  const list = terminalList ?? noribaList;
  if (!list) return [];
  for (const t of ['T1', 'T2']) {
    const arr = list[t] || [];
    if (arr.length === 0) continue;
    lines.push(TERMINAL_HEAD[t]);
    for (const f of arr) lines.push(arrivalLine(f));
  }
  return lines;
}

export function isStale(generatedAt, nowMs, maxMinutes = STALE_MINUTES) {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return (nowMs - t) > maxMinutes * 60 * 1000;
}

const COLLAPSE_KEY = 'forecast-section-collapsed';

/** 折りたたみ状態を localStorage から読む。"1" なら true、他は false。例外時も false。 */
export function getCollapsed(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try { return storage.getItem(COLLAPSE_KEY) === '1'; }
  catch { return false; }
}

/** 折りたたみ状態を localStorage へ書く。true→"1"/false→"0"。例外は無視。 */
export function setCollapsed(value, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(COLLAPSE_KEY, value ? '1' : '0'); }
  catch { /* ストレージ無効時は無視 */ }
}

/** トグルボタンを初期化。クリックで forecast-body の hidden 属性と localStorage を更新。 */
export function initForecastSectionToggle() {
  const btn = document.getElementById('forecast-section-toggle');
  const body = document.getElementById('forecast-body');
  if (!btn || !body) return;
  const apply = (collapsed) => {
    body.hidden = collapsed;
    // [hidden] が CSS で効かない環境(古いiOS等)への保険として inline style も明示
    body.style.display = collapsed ? 'none' : '';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = collapsed ? '▶ 展開' : '▼ 折りたたみ';
  };
  apply(getCollapsed());
  btn.addEventListener('click', () => {
    const next = !getCollapsed();
    setCollapsed(next);
    apply(next);
  });
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
  const srcErrEl = document.getElementById('pool-status-source-error');
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
    if (error || !data) { metaEl.textContent = 'プール現況を取得できていません'; return; }
    const ts = String(data.generatedAt).slice(11, 16);
    // 先方提供の映像ソース(羽田タクシープール定点カメラ)が更新されていない時の注意喚起。
    // observe 側が右下タイムスタンプ未更新を検知し pool-status.json.sourceStale=true を載せる。
    if (srcErrEl) {
      if (data.sourceStale === true) {
        const since = data.sourceStaleSince ? String(data.sourceStaleSince).slice(11, 16) : null;
        srcErrEl.innerHTML = `⚠ 先方提供している羽田空港のタクシープール映像にエラーが起こっているため、現況を更新できていません${since ? `（最終更新: ${since}）` : ''}。表示中の情報は古い可能性があります。`;
        srcErrEl.style.display = '';
      } else {
        srcErrEl.style.display = 'none';
      }
    }
    if (data.sourceStale === true) {
      metaEl.textContent = `📷 映像エラーのため更新停止中（最終: ${ts}）`;
    } else if (isStale(data.generatedAt, Date.now())) {
      metaEl.textContent = `📷 情報が更新されていません（最終: ${ts}）`;
    } else {
      metaEl.textContent = `📷 ${ts}時点`;
    }
    if (actEl) {
      actEl.innerHTML = `<strong>今日の流れ</strong> ${formatActivityLine(data.activity || {})}`;
    }
    if (stallsEl) {
      const stalls = data.stalls;
      if (stalls) {
        const order = ['stall1', 'stall2', 'stall3', 'stall4'];
        const head = '<div style="color:var(--sub); font-size:11px; margin-bottom:4px;">乗り場の動き（バー＝直近1時間に出た台数）</div>';
        stallsEl.innerHTML = head + order
          .filter(k => stalls[k])
          .map(k => `<div>${formatStallLineV2(stalls[k])}</div>`)
          .join('');
      } else {
        stallsEl.innerHTML = '';
      }
    }
    if (arrivalsEl) {
      const lines = formatArrivalsList(data.noribaArrivalsList, data.terminalArrivalsList);
      if (lines.length) {
        const head = '<div style="color:var(--sub); font-size:12px; margin-top:8px; margin-bottom:4px;">✈ これからお客がロビーに出る便</div>';
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

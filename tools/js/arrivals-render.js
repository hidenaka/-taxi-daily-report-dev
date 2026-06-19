import { airlineToColorKey } from './airline-color.js';

const VALID_TERMINALS = new Set(['T1', 'T2', 'T3']);

// 乗り場(号)別 到着見込みカード。summary = summarizeByNoriba() の戻り値。
export function renderNoribaCards(container, summary) {
  if (!container) return;
  const { lanes, undetermined, windowMin } = summary;
  const isLate = summary.isLateNight;
  const cards = lanes.map((l) => {
    // 通常は直近便、21時以降は最終便を出す
    let lastLine;
    if (isLate) {
      lastLine = l.lastFlight
        ? `<div class="nc-last">🏁 最終 ${l.lastFlight.time} ${l.lastFlight.fromName ?? ''}${l.lastFlight.seatCount ? ` 定員${l.lastFlight.seatCount}` : ''}</div>`
        : `<div class="nc-last nc-none">本日の到着終了</div>`;
    } else {
      const next = l.flights[0];
      lastLine = next
        ? `<div class="nc-next">直近 ${next.time} ${next.fromName ?? ''}</div>`
        : `<div class="nc-next nc-none">予定なし</div>`;
    }
    const seatUnk = l.seatUnknown > 0 ? ` ・定員不明${l.seatUnknown}便` : '';
    return `
    <div class="noriba-card nlane-${l.lane}">
      <div class="nc-head"><span class="nc-num">${l.lane}号</span><span class="nc-label">${l.label}</span></div>
      <div class="nc-pax">${l.seatSum}<span class="nc-unit">人(定員)</span></div>
      <div class="nc-sub">${l.count}便 ・推定${l.taxiPax}人${seatUnk}</div>
      ${lastLine}
    </div>`;
  }).join('');
  const foot = undetermined > 0
    ? `<div class="nc-foot">＋ 乗り場未定 ${undetermined}便（到着が近づくと判明）</div>`
    : '';
  const wins = [30, 60, 120].map((w) =>
    `<button type="button" class="ncw-btn${w === windowMin ? ' is-active' : ''}" data-win="${w}">今後${w}分</button>`
  ).join('');
  container.innerHTML = `
    <div class="noriba-head">
      <h2>🚕 乗り場別 到着見込み${isLate ? '（最終便）' : ''}</h2>
      <div class="nc-window" role="group" aria-label="対象時間">${wins}</div>
    </div>
    <div class="noriba-cards">${cards}</div>
    ${foot}
    <div class="nc-note">定員＝便の最大座席数（確実）。推定＝タクシー利用見込み（来ない場合あり）。欠航除外。</div>`;
}

const TIER_INFO = {
  high: { label: '多い', emoji: '🟥' },
  mid:  { label: '普通', emoji: '🟧' },
  low:  { label: '少ない', emoji: '🟦' }
};

export function renderHeatmap(container, bins) {
  container.innerHTML = '';
  if (bins.length === 0) {
    container.innerHTML = '<div class="empty">表示可能な時間帯がありません</div>';
    return;
  }
  const maxVal = Math.max(1, ...bins.map(b => b.totalPax));
  for (const b of bins) {
    const row = document.createElement('div');
    row.className = `heatmap-row tier-${b.densityTier}`;
    const totalWidthPct = (b.totalPax / maxVal) * 100;
    const intlWidthPct = (b.totalPax > 0) ? (b.internationalPax / b.totalPax) * 100 : 0;
    const unknownNote = b.unknownCount > 0 ? ` <span class="unknown-note">機材不明${b.unknownCount}</span>` : '';
    const delayBadge = b.delayedCount > 0 ? ` <span class="delay-badge">⚠${b.delayedCount}遅延</span>` : '';
    const intlBadge = b.internationalPax > 0
      ? ` <span class="intl-badge">国際${b.internationalPax}人</span>`
      : '';
    const tier = TIER_INFO[b.densityTier];
    const tierBadge = b.totalPax > 0
      ? ` <span class="tier-badge">${tier.emoji}${tier.label}</span>`
      : '';
    const valueLabel = `${b.totalPax}人 (${b.flightCount}便)`;
    row.innerHTML = `
      <span class="heatmap-time">${b.bin}</span>
      <span class="heatmap-bar-wrap">
        <span class="heatmap-bar" style="width:${totalWidthPct}%">
          <span class="heatmap-bar-intl" style="width:${intlWidthPct}%"></span>
        </span>
      </span>
      <span class="heatmap-label">${valueLabel}${unknownNote}${delayBadge}${intlBadge}${tierBadge}</span>
    `;
    container.appendChild(row);
  }
}

export function renderLegend(container) {
  if (!container || container.dataset.rendered === '1') return;
  container.innerHTML = `
    <span class="legend-item legend-low"><span class="legend-swatch"></span>少ない</span>
    <span class="legend-item legend-mid"><span class="legend-swatch"></span>普通</span>
    <span class="legend-item legend-high"><span class="legend-swatch"></span>多い</span>
    <span class="legend-item legend-intl"><span class="legend-swatch"></span>国際線</span>
  `;
  container.dataset.rendered = '1';
}

export function renderSummary(container, summary) {
  if (!container) return;
  if (summary.totalFlights === 0) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const delayPart = summary.delayedCount > 0
    ? `<span class="summary-delay">⚠ ${summary.delayedCount}便遅延</span>`
    : `<span class="summary-ok">全便定刻</span>`;
  const intlPart = summary.internationalPax > 0
    ? `<span class="summary-intl">うち国際 ${summary.internationalPax.toLocaleString()}人 (${summary.internationalCount}便)</span>`
    : '';
  const reachNonePart = summary.reachNoneCount > 0
    ? `<span class="summary-item summary-reach-none">🔴 ${summary.reachNoneCount}便（公共交通不可）</span>`
    : '';
  const cancelledPart = summary.cancelledCount > 0
    ? `<span class="summary-item summary-cancelled">🚫 欠航 ${summary.cancelledCount}便（降客数から除外済み）</span>`
    : '';
  container.innerHTML = `
    ${cancelledPart}
    <span class="summary-item">${summary.windowLabel} <strong>${summary.totalPax.toLocaleString()}人</strong></span>
    <span class="summary-item">時間あたり <strong>${summary.hourlyAvg.toLocaleString()}人</strong></span>
    <span class="summary-item">${summary.totalFlights}便</span>
    ${reachNonePart}
    ${intlPart}
    ${delayPart}
  `;
}

// 「到着の谷間/手薄」バナー。detectArrivalGap の戻り値(または null)を受け取る。
export function renderArrivalGap(container, gap) {
  if (!container) return;
  if (!gap) { container.innerHTML = ''; container.hidden = true; container.className = 'arrival-gap'; return; }
  const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  container.hidden = false;
  if (gap.kind === 'gap') {
    container.className = 'arrival-gap is-gap';
    container.innerHTML = `⏳ <b>到着の谷間 ${fmt(gap.startMin)}〜${fmt(gap.endMin)}</b>　この間はロビーに出る客がぐっと減ります`;
  } else {
    container.className = 'arrival-gap is-lull';
    container.innerHTML = `△ <b>${fmt(gap.startMin)}頃は到着が手薄</b>　ロビーに出る客が少なめ`;
  }
}

export function renderTopics(container, topics) {
  if (!container) return;
  if (topics.length === 0) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const items = topics.map(t => {
    const paxLabel = (t.estimatedPax !== null && t.estimatedPax !== undefined)
      ? `約${t.estimatedPax}人`
      : '推定不可';
    const detail = `${t.scheduledTime}→${t.estimatedTime} (${t.delayMin}分遅延) / ${paxLabel}`;
    // ターミナルの隣に号(poolLane 1-4)を併記。未確定は号を出さない。
    const laneSuffix = (Number.isInteger(t.poolLane) && t.poolLane >= 1 && t.poolLane <= 4)
      ? ` <span class="topic-lane lane-${t.poolLane}">${t.poolLane}号</span>` : '';
    return `<div class="topic-item">
      <span class="topic-flight">${t.flightNumber}</span>
      <span class="topic-from">${t.fromName}</span>
      <span class="topic-detail">${detail}</span>
      <span class="topic-terminal">${t.terminal}${laneSuffix}</span>
    </div>`;
  }).join('');
  container.innerHTML = `
    <div class="topic-header">⏰ 大幅遅延便情報 (${topics.length}件)</div>
    ${items}
  `;
}

export function renderWeatherBanner(container, weather) {
  if (!container) return;
  if (!weather) {
    container.innerHTML = '';
    container.hidden = true;
    container.classList.remove('is-active', 'is-recovery');
    return;
  }
  if (weather.lightningActive) {
    container.hidden = false;
    container.classList.add('is-active');
    container.classList.remove('is-recovery');
    container.innerHTML = `
      <span class="weather-icon">🌩</span>
      <span class="weather-msg"><strong>雷活動中</strong> — 羽田着陸見合わせの可能性。便遅延・滞留に注意</span>
    `;
    return;
  }
  if (weather.lightningRecoveryStartHHMM) {
    container.hidden = false;
    container.classList.add('is-recovery');
    container.classList.remove('is-active');
    container.innerHTML = `
      <span class="weather-icon">⚡</span>
      <span class="weather-msg"><strong>雷解除 ${weather.lightningRecoveryStartHHMM}</strong> — 滞留便ラッシュ需要中（60分窓）</span>
    `;
    return;
  }
  // 雨・雪・霧などの悪天候は、出庫観測 (夜の行灯/路面反射) にノイズが乗りやすい。
  // 天気と観測注記を表示して「数値は参考」と分かるようにする。
  const wx = weatherCodeToLabel(weather.weatherCode);
  const isBadWeather = wx && wx.advisory;
  if (isBadWeather) {
    container.hidden = false;
    container.classList.remove('is-active', 'is-recovery');
    container.classList.add('is-weather');
    const precip = (typeof weather.precipitation === 'number' && weather.precipitation > 0)
      ? ` ${weather.precipitation}mm/h` : '';
    const temp = (typeof weather.temperature === 'number')
      ? ` ・ ${weather.temperature}℃` : '';
    container.innerHTML = `
      <span class="weather-icon">${wx.icon}</span>
      <span class="weather-msg"><strong>${wx.label}${precip}</strong>${temp} — ${wx.advisory}</span>
    `;
    return;
  }
  container.innerHTML = '';
  container.hidden = true;
  container.classList.remove('is-active', 'is-recovery', 'is-weather');
}

// WMO weather code を アイコン・ラベル・観測注記 (advisory) に変換する純関数。
// advisory が非 null の天気は「出庫観測に影響しうる悪天候」としてバナー表示する。
export function weatherCodeToLabel(code) {
  if (code == null || typeof code !== 'number') return null;
  if (code >= 95) return { icon: '⛈', label: '雷雨', advisory: '着陸見合わせ・滞留の可能性。観測値も反射ノイズで揺れやすい' };
  if (code >= 80 && code <= 82) return { icon: '🌦', label: 'にわか雨', advisory: '路面反射で夜間の観測値がやや多めに出ることがある' };
  if (code >= 71 && code <= 77) return { icon: '❄', label: '雪', advisory: '視界低下で観測精度が落ちる可能性' };
  if (code >= 61 && code <= 67) return { icon: '☔', label: '雨', advisory: '路面反射で夜間の観測値がやや多めに出ることがある' };
  if (code >= 51 && code <= 57) return { icon: '🌧', label: '霧雨', advisory: '弱い反射ノイズの可能性' };
  if (code === 45 || code === 48) return { icon: '🌫', label: '霧', advisory: '視界低下で観測精度が落ちる可能性' };
  // 快晴〜曇りは advisory なし (バナー非表示)
  return { icon: '☁', label: '曇り', advisory: null };
}

export function renderStaleBanner(container, classification) {
  if (!container) return;
  // suppressed (JST 5時前 or updatedAt 欠損) は fresh と同じく非表示
  if (!classification || classification.level === 'fresh' || classification.level === 'suppressed') {
    container.innerHTML = '';
    container.hidden = true;
    container.classList.remove('is-warn', 'is-critical');
    return;
  }
  const { level, ageMinutes } = classification;
  container.hidden = false;
  if (level === 'warn') {
    container.classList.add('is-warn');
    container.classList.remove('is-critical');
    container.innerHTML = `
      <span class="stale-icon">⚠</span>
      <span class="stale-msg">データが <strong>${ageMinutes}分前</strong>。更新が遅延している可能性があります。</span>
    `;
    return;
  }
  // critical
  container.classList.add('is-critical');
  container.classList.remove('is-warn');
  container.innerHTML = `
    <span class="stale-icon">⚠</span>
    <span class="stale-msg">データが <strong>${ageMinutes}分前</strong>。更新が止まっている可能性があります。参考程度にご確認ください。</span>
  `;
}

// 1便分の flight-row 要素を生成して container に append する純関数。
function appendFlightRow(container, f) {
  const isDelayed = f.status === '遅延';
  const isCancelled = f.status === '欠航';
  const isUnknown = f.aircraftCode === null;
  const colorKey = airlineToColorKey(f.airline);
  const row = document.createElement('div');
  row.className = 'flight-row airline-' + colorKey
    + (isDelayed ? ' is-delayed' : '')
    + (isCancelled ? ' is-cancelled' : '')
    + (isUnknown ? ' is-unknown' : '');
  const time = f.estimatedTime ?? f.scheduledTime ?? '--:--';
  const aircraft = f.aircraftCode ?? '機材不明';
  const hasPax = f.estimatedPax !== null && f.estimatedPax !== undefined;
  const hasSeats = f.seatCount !== null && f.seatCount !== undefined;
  const paxLine = hasPax
    ? `<span class="pax-est">推定搭乗 ${f.estimatedPax}人</span>`
      + (hasSeats ? `<span class="pax-max">（最大 ${f.seatCount}人）</span>` : '')
    : `<span class="pax-est">搭乗人数 推定不可</span>`;
  const statusIcon = isDelayed ? ' ⚠' : '';
  const reachIcon = f.reachTier === 'high' ? '🟢'
                  : f.reachTier === 'mid'  ? '🟡'
                  : f.reachTier === 'low'  ? '🟡'
                  : f.reachTier === 'none' ? '🔴'
                  : '';
  const delayBoostBadge = (f.taxiDelayBoost && f.taxiDelayBoost > 1.0)
    ? ` <span class="delay-boost">遅延+深夜</span>` : '';
  const lightningBadge = (f.taxiLightningBoost && f.taxiLightningBoost > 1.0)
    ? ` <span class="lightning-boost">⚡ラッシュ</span>` : '';
  const terminalTag = (f.terminal && VALID_TERMINALS.has(f.terminal))
    ? `<span class="terminal-tag ${f.terminal.toLowerCase()}">${f.terminal}</span>` : '';
  const laneTag = (Number.isInteger(f.poolLane) && f.poolLane >= 1 && f.poolLane <= 4)
    ? `<span class="lane-tag lane-${f.poolLane}">${f.poolLane}号</span>` : '';
  row.innerHTML = `
    <div class="flight-line1">
      <span class="time">${time}</span>
      <span class="flight-no">${f.flightNumber}</span>
      <span class="from">${f.fromName}</span>
      <span class="reach">${reachIcon}</span>
      ${terminalTag}${laneTag}
    </div>
    <div class="flight-line2">${paxLine}</div>
    <div class="flight-line3">機材 ${aircraft} ・ ${isCancelled
      ? `<span class="status status-cancelled">🚫 欠航</span>`
      : `<span class="status">${f.status}${statusIcon}${delayBoostBadge}${lightningBadge}</span>`}</div>
  `;
  container.appendChild(row);
}

// 便リストを時刻順に並列で描画する。
// flights は呼び出し側で sortFlightsByTime() 等によりソート済み前提。
export function renderFlightList(container, flights) {
  if (!container) return;
  container.innerHTML = '';
  if (!flights || flights.length === 0) {
    container.innerHTML = '<div class="empty">表示可能な便がありません</div>';
    return;
  }
  for (const f of flights) appendFlightRow(container, f);
}

export function renderUpdatedAt(container, updatedAt, totalUnknownAircraft) {
  const t = new Date(updatedAt);
  const minAgo = Math.floor((Date.now() - t.getTime()) / 60000);
  const stale = minAgo > 10;
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  container.innerHTML = `
    <span class="updated">最終更新: ${hh}:${mm} (${minAgo}分前)${stale ? ' ⚠ データが古い' : ''}</span>
    <span class="unknown-stat">${totalUnknownAircraft > 0 ? `機材不明: ${totalUnknownAircraft}便` : ''}</span>
    <span class="source">データ出典: ODPT / 国交省統計</span>
  `;
  container.classList.toggle('is-stale', stale);
}

// タクシーセンターの現地案内(末尾規制 + 遅延便案内)を描画。
// notice が無い/案内が無ければ非表示(普段は邪魔しない)。
export function renderPoolNotice(el, notice) {
  if (!el) return;
  if (!notice || (!notice.tailRegulation && !notice.hasFlightNotice)) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const parts = [];
  if (notice.tailRegulation) {
    parts.push(`<div class="pn-tail">🚧 末尾規制：<b>${esc(notice.tailRegulation)}</b>（この末尾のみ入構可）</div>`);
  }
  if (notice.hasFlightNotice && notice.flightNoticeText) {
    parts.push(`<div class="pn-flight"><div class="pn-h">🚖 タクシーセンター現地案内</div><pre class="pn-text">${esc(notice.flightNoticeText)}</pre></div>`);
  }
  el.innerHTML = parts.join('');
  el.hidden = false;
}

// ── 乗り場アクティビティ（号別の今） ──────────────────────────────
// 動きの推移カーブを SVG文字列で返す(viewBoxで幅100%スケール)。
export function renderMovementCurveSvg(curve) {
  if (!curve || !Array.isArray(curve.normal) || curve.normal.length < 2) return '';
  const W = 304, H = 56, N = curve.normal.length;
  const all = curve.normal.concat(curve.today.filter((v) => v != null), curve.forecast.filter((v) => v != null));
  const mx = Math.max(1, ...all);
  const X = (i) => (i / (N - 1) * W).toFixed(1);
  const Y = (v) => (H - (v / mx) * (H - 8) - 4).toFixed(1);
  const poly = (arr, color, dash) => {
    const pts = arr.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(' ');
    if (!pts) return '';
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${dash ? 1.3 : 2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  const nx = X(curve.nowIndex);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:56px;display:block">`
    + poly(curve.normal, '#7f8aa0', '4 3')
    + poly(curve.today, '#ff9a9a', null)
    + poly(curve.forecast, '#ff9a9a', '3 3')
    + `<line x1="${nx}" y1="2" x2="${nx}" y2="${H - 2}" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/></svg>`;
}

const _NORIBA_TERM_CLASS = { T1: 'nt-t1', T2: 'nt-t2' };
function _ratioBadge(dir) {
  if (!dir) return '';
  const txt = dir === 'up' ? '通常より多い' : (dir === 'down' ? '通常より静か' : '通常並み');
  const arrow = dir === 'up' ? '↑' : (dir === 'down' ? '↓' : '≈');
  return `<span class="nrbadge nr-${dir}">${txt}${arrow}</span>`;
}
function _untilText(activeUntil) {
  if (activeUntil == null) return '';
  if (activeUntil === 'soon') return '⏱ まもなく落ち着く';
  if (activeUntil === 'long') return '⏱ 当面 活発';
  return `⏱ 活発 〜${activeUntil}`;
}
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// 号別メーターカードを描画。container は #noriba-cards-section を流用。
// 号別「乗り場の状況」を中立に提示(評価しない)。container は #noriba-cards-section を流用。
export function renderNoribaActivity(container, activity, opts = {}) {
  if (!container) return;
  if (!Array.isArray(activity) || activity.length === 0) { container.innerHTML = ''; return; }
  const dots = (n) => { let h = ''; for (let i = 0; i < 5; i++) h += `<i class="${i < n ? 'on' : ''}"></i>`; return h; };
  const segs = (n, hot) => { let h = ''; for (let i = 0; i < 5; i++) h += `<i class="${i < n ? (hot ? 'hi' : 'on') : ''}"></i>`; return h; };
  const fwdText = (au) => {
    if (au == null) return '';
    if (au === 'soon') return 'まもなく落ち着き';
    if (au === 'long') return 'しばらく続く見込み';
    return `〜${au} ごろまで`;
  };
  const cards = activity.map((a) => {
    const tcls = a.terminal === 'T1' ? 't1' : 't2';
    const mv = a.movement || {};
    const fill = (typeof mv.fillPct === 'number') ? mv.fillPct : 0;
    const lvl = mv.level || '—';
    const flowRow = (mv.level != null)
      ? `<span class="ns-lab">流れ</span><div class="ns-trk"><div class="fill" style="width:${fill}%"></div>${mv.normalMarkerPct != null ? `<div class="norm" style="left:${mv.normalMarkerPct}%"></div><div class="normlab" style="left:${mv.normalMarkerPct}%">通常</div>` : ''}</div><span class="ns-val">${_esc(lvl)}</span>`
      : '';
    const occRow = (a.occupancy && a.occupancy.label != null)
      ? `<span class="ns-lab">待機車両</span><div class="ns-segs">${segs(a.occupancy.segments, a.occupancy.segments >= 4)}</div><span class="ns-val">${_esc(a.occupancy.label)}</span>`
      : '';
    const fwd = (mv.level != null && a.movement.curve)
      ? `<div class="ns-fwd">この先 <span class="ns-spark" data-spark="${(mv.sparkFuture || []).join(',')}" data-color="#8a8f88"></span> ${_esc(fwdText(mv.activeUntil))}<span class="ns-more">詳細 ›</span></div>`
      : `<div class="ns-fwd"><span class="ns-more" style="margin-left:auto">詳細 ›</span></div>`;
    const flList = (a.detailFlights || []).slice(0, 6).map((f) => {
      const pax = (typeof f.taxiPax === 'number') ? `・約${f.taxiPax}人` : '';
      const seat = (typeof f.seatCount === 'number') ? `定員${f.seatCount}` : '';
      return `<div class="ns-fl"><span class="o">${_esc(f.time)} ${_esc(f.fromName)}</span><span class="m">${seat}${pax}</span></div>`;
    }).join('') || `<div class="ns-fl"><span class="m">60分内の到着便はありません</span></div>`;
    const last = a.demand && a.demand.lastFlight ? `<div class="ns-fl" style="border:0"><span class="o">最終便</span><span class="m">${_esc(a.demand.lastFlight.time)} ${_esc(a.demand.lastFlight.fromName)}</span></div>` : '';
    const curveSvg = renderMovementCurveSvg(a.movement && a.movement.curve);
    const nextF = a.demand && a.demand.nextFlight ? `次 ${_esc(a.demand.nextFlight.time)} ${_esc(a.demand.nextFlight.fromName)}` : '';
    return `<div class="ns-card ${tcls}" data-noriba="${a.lane}">
      <div class="ns-top"><span class="no">${a.lane}</span><span class="term">${_esc(a.terminal)}</span><span class="last">${nextF}</span></div>
      <div class="ns-met">
        <span class="ns-lab">到着便</span><div class="ns-planes">${dots(a.demand.planeIcons)}</div><span class="ns-val">60分内 ${a.demand.flights60}便</span>
        ${occRow}
        ${flowRow}
      </div>
      ${fwd}
      <div class="ns-detail" hidden>
        <h5>到着便（60分内）</h5>${flList}
        ${curveSvg ? `<div class="ns-curve"><div class="ns-clab">流れの推移 ── 今日(実測/予測) ┈通常</div>${curveSvg}</div>` : ''}
        ${last}
      </div>
    </div>`;
  }).join('');
  const head = `<div class="ns-hd"><span class="ttl">乗り場の状況</span></div><div class="ns-asof"><b>${_esc(opts.updatedLabel || '')}</b> 時点</div>`;
  container.innerHTML = `<div class="ns-wrap">${head}${cards}</div>`;
  container.querySelectorAll('[data-spark]').forEach((el) => {
    const v = el.getAttribute('data-spark').split(',').map(Number).filter((x) => !Number.isNaN(x));
    if (v.length < 2) return;
    const w = 46, h = 12, mx = Math.max(...v, 1);
    const pts = v.map((a, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - a / mx * (h - 2) - 1).toFixed(1)}`).join(' ');
    el.innerHTML = `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="${el.getAttribute('data-color')}" stroke-width="1.3"/></svg>`;
  });
  container.querySelectorAll('.ns-card').forEach((card) => {
    card.addEventListener('click', () => {
      const d = card.querySelector('.ns-detail');
      if (d) { d.hidden = !d.hidden; card.classList.toggle('open', !d.hidden); }
    });
  });
}

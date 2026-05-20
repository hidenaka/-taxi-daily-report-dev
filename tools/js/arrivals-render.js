import { airlineToColorKey } from './airline-color.js';

const VALID_TERMINALS = new Set(['T1', 'T2', 'T3']);

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
    <span class="legend-item legend-low"><span class="legend-swatch"></span>少ない (300人未満/30分)</span>
    <span class="legend-item legend-mid"><span class="legend-swatch"></span>普通 (300〜600人)</span>
    <span class="legend-item legend-high"><span class="legend-swatch"></span>多い (600人以上)</span>
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
  container.innerHTML = `
    <span class="summary-item">${summary.windowLabel} <strong>${summary.totalPax.toLocaleString()}人</strong></span>
    <span class="summary-item">時間あたり <strong>${summary.hourlyAvg.toLocaleString()}人</strong></span>
    <span class="summary-item">${summary.totalFlights}便</span>
    ${reachNonePart}
    ${intlPart}
    ${delayPart}
  `;
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
    return `<div class="topic-item">
      <span class="topic-flight">${t.flightNumber}</span>
      <span class="topic-from">${t.fromName}</span>
      <span class="topic-detail">${detail}</span>
      <span class="topic-terminal">${t.terminal}</span>
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
  container.innerHTML = '';
  container.hidden = true;
  container.classList.remove('is-active', 'is-recovery');
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
    <span class="stale-msg">データが <strong>${ageMinutes}分前</strong>。API 停止の可能性があるため参考程度にしてください。</span>
  `;
}

export function renderFlightList(container, flights) {
  container.innerHTML = '';
  if (flights.length === 0) {
    container.innerHTML = '<div class="empty">表示可能な便がありません</div>';
    return;
  }
  for (const f of flights) {
    const row = document.createElement('div');
    const isDelayed = f.status === '遅延';
    const isUnknown = f.aircraftCode === null;
    const colorKey = airlineToColorKey(f.airline);
    row.className = 'flight-row'
      + ` airline-${colorKey}`
      + (isDelayed ? ' is-delayed' : '')
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
      ? ` <span class="delay-boost">遅延+深夜</span>`
      : '';
    const lightningBadge = (f.taxiLightningBoost && f.taxiLightningBoost > 1.0)
      ? ` <span class="lightning-boost">⚡ラッシュ</span>`
      : '';
    const terminalTag = (f.terminal && VALID_TERMINALS.has(f.terminal))
      ? `<span class="terminal-tag">${f.terminal}</span>` : '';
    row.innerHTML = `
      <div class="flight-line1">
        <span class="time">${time}</span>
        <span class="flight-no">${f.flightNumber}</span>
        <span class="from">${f.fromName}</span>
        <span class="reach">${reachIcon}</span>
        ${terminalTag}
      </div>
      <div class="flight-line2">${paxLine}</div>
      <div class="flight-line3">機材 ${aircraft} ・ <span class="status">${f.status}${statusIcon}${delayBoostBadge}${lightningBadge}</span></div>
    `;
    container.appendChild(row);
  }
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

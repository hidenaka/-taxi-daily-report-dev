import { buildCardModel, formatFare } from './airport-fare-data.js';

// container に料金カードを描画。area=null なら初期メッセージ。
export function renderFareCard(container, area, now = new Date()) {
  if (!area) {
    container.innerHTML = '<div class="fare-empty">区を地図でタッチ、または検索してください</div>';
    return;
  }
  const m = buildCardModel(area, now);
  const dayCls = m.isLate ? '' : ' is-now';
  const nightCls = m.isLate ? ' is-now' : '';
  const badge = m.isLate
    ? '<span class="fare-badge">今は深夜料金</span>'
    : '<span class="fare-badge fare-badge-day">今は昼料金</span>';
  container.innerHTML = `
    <div class="fare-card">
      <div class="fare-card-head">${m.name} ${badge}</div>
      <table class="fare-table">
        <thead><tr><th></th><th>羽田</th><th>成田</th></tr></thead>
        <tbody>
          <tr class="fare-row-day${dayCls}">
            <td>定額（昼）</td><td>${formatFare(m.haneda.day)}</td><td>${formatFare(m.narita.day)}</td>
          </tr>
          <tr class="fare-row-night${nightCls}">
            <td>定額（深夜 22-5時）</td><td>${formatFare(m.haneda.night)}</td><td>${formatFare(m.narita.night)}</td>
          </tr>
        </tbody>
      </table>
      <div class="fare-note">※定額に高速代は含みません（ルート・時間帯で変動・別途）</div>
    </div>`;
}

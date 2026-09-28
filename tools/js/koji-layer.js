// tools/js/koji-layer.js — 工事マップの描画（Leaflet 側の配線だけ）
//
// 材料づくりは koji-data.js（純関数・テストあり）。ここは地図に線と点を置くだけ。
// データ: tools/data/koji.json（GitHub Actions が1日1回、工事マップ側の API から取り込む）
// 出典表示は利用条件なので必ず出す（東京都建設局 CC BY 4.0 / © OpenStreetMap contributors）。
//
// ドライバー向けの約束（引き継ぎ資料 §8）:
//   - 走行中に読ませない。停車中・客待ち中に一目で分かる形だけ
//   - 出すのは「いま（またはこの先1〜2時間）ふさがっている所」だけ
//   - 位置が目安のもの(placement=approx)は線で描かない
import { selectActive, laneLevel, levelInfo, windowLabel, periodLabel, jamNote, countByLevel } from './koji-data.js';

const DATA_URL = './data/koji.json';

export function createKojiLayer(map, { onStatus } = {}) {
  const group = L.layerGroup();
  let data = null;      // { features, fetchedAt, source }
  let visible = false;
  let timeMs = Date.now();
  let loadError = '';

  async function load() {
    if (data) return data;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      loadError = '工事データを読み込めませんでした。通信のあるところで開き直してください。';
    }
    return data;
  }

  function bounds() {
    const b = map.getBounds().pad(0.15);
    return { minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() };
  }

  function popupHtml(p) {
    const lv = levelInfo(laneLevel(p));
    const jam = jamNote(p, new Date(timeMs + 9 * 3600 * 1000).getUTCHours());
    const approx = p.placement === 'approx'
      ? '<div class="kj-warn">この工事は位置が目安です</div>' : '';
    return `<div class="kj-pop">
      <div class="kj-pop-title">${esc(p.title || '工事')}</div>
      <div class="kj-pop-lv"><i style="background:${lv.color}"></i>${lv.label}${jam ? `・<b>${jam}</b>` : ''}</div>
      <div class="kj-pop-row">${esc(windowLabel(p.timeWindow))}</div>
      ${p.laneSummary ? `<div class="kj-pop-row">${esc(p.laneSummary)}</div>` : ''}
      <div class="kj-pop-row kj-dim">${esc(periodLabel(p))}</div>
      ${approx}
      <div class="kj-pop-note">予定に基づく目安。実際の通行は現地の標識・警察の指示に従ってください。</div>
    </div>`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function draw() {
    group.clearLayers();
    if (!data) {
      onStatus?.({ error: loadError });
      return;
    }
    const picked = selectActive(data.features, timeMs, bounds());
    for (const f of picked) {
      const p = f.properties || {};
      const color = levelInfo(laneLevel(p)).color;
      const approx = p.placement === 'approx';
      let layer;
      if (f.geometry.type === 'LineString' && !approx) {
        layer = L.polyline(f.geometry.coordinates.map((c) => [c[1], c[0]]),
          { color, weight: 6, opacity: 0.9, lineCap: 'round' });
      } else {
        const c = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0];
        layer = L.circleMarker([c[1], c[0]], {
          radius: 7, color: approx ? '#ffffff' : color, weight: approx ? 2 : 1,
          fillColor: color, fillOpacity: approx ? 0.35 : 0.85,
        });
      }
      layer.bindPopup(() => popupHtml(p), { maxWidth: 280 });
      layer.addTo(group);
    }
    onStatus?.({
      shown: picked.length,
      total: selectActive(data.features, timeMs).length,
      counts: countByLevel(picked),
      fetchedAt: data.fetchedAt,
      dataset: data.source?.dataset || '',
      error: loadError,
    });
  }

  async function setVisible(on) {
    visible = on;
    if (!on) { map.removeLayer(group); return; }
    group.addTo(map);
    onStatus?.({ loading: true });
    await load();
    draw();
  }

  function setTime(ms) {
    timeMs = ms;
    if (visible) draw();
  }

  function refresh() { if (visible) draw(); }

  return { setVisible, setTime, refresh, isVisible: () => visible };
}

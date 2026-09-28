// tools/js/koji-layer.js — 工事マップの描画（MapLibre GL 側の配線だけ）
//
// 描き方は工事マップ本家（ハッカソン/osanpo-safety の public/radar.js）と同じにそろえる:
//   遠目は「雨雲」のような熱の濃淡、近づくと 白い縁取り＋ふさぎ具合の色の線、
//   点は丸、位置が目安のものは白抜きの丸。線はどちら側の車線かに応じて左右へ寄せる。
// 材料づくりは koji-data.js（純関数・テストあり）。
// データ: tools/data/koji.json（GitHub Actions が1日1回、工事マップ側の API から取り込む）
// 出典表示は利用条件なので必ず出す（東京都建設局 CC BY 4.0 / © OpenStreetMap contributors）。
import {
  toDisplay, selectActive, intersects, laneLevel, levelInfo, LEVELS,
  windowLabel, periodLabel, jamNote, countByLevel, sideLabel,
  samplePoints, HEAT_WEIGHT,
} from './koji-data.js';

const DATA_URL = './data/koji.json';
const SRC = 'koji';
const HEAT_SRC = 'koji-heat';
const LAYERS = ['koji-heat', 'koji-off-line', 'koji-off-pt', 'koji-casing', 'koji-line', 'koji-pt', 'koji-approx'];

// 線の太さの倍率（ふさぐほど太い）— 本家と同じ
const WIDTH_BY_LEVEL = ['match', ['get', 'level'], 'closed', 2, 'alternating', 1.6, 'half', 1.3, 1];
const colorExpr = ['match', ['get', 'level'], ...LEVELS.flatMap((l) => [l.key, l.color]), '#888'];
const zoomW = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
const zoomWL = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, ['*', WIDTH_BY_LEVEL, a], 16, ['*', WIDTH_BY_LEVEL, b]];
const shift = (a, b) => ['interpolate', ['linear'], ['zoom'], 11, ['*', ['get', 'side'], a], 16, ['*', ['get', 'side'], b]];
const isLine = ['==', ['geometry-type'], 'LineString'];
const isPt = ['==', ['geometry-type'], 'Point'];
const on = ['==', ['get', 'st'], 2];
const off = ['==', ['get', 'st'], 1];
const approx = ['==', ['get', 'placement'], 'approx'];

export function createKojiLayer(map, { onStatus } = {}) {
  let data = null;          // { features, fetchedAt, source }
  let visible = false;
  let timeMs = Date.now();
  let loadError = '';
  let added = false;
  let popup = null;

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

  function addLayers() {
    if (added) return;
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource(SRC, { type: 'geojson', data: empty, attribution: '東京都建設局 路上工事情報(CC BY 4.0) / © OpenStreetMap contributors' });
    map.addSource(HEAT_SRC, { type: 'geojson', data: empty });

    // 遠目で見たときの「雨雲」: 工事が集まって車線を多くふさぐ所ほど黄→橙→赤。近づくと消える
    map.addLayer({
      id: 'koji-heat', type: 'heatmap', source: HEAT_SRC, maxzoom: 14,
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1.3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 16, 11, 30, 13, 44],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.85, 12.5, 0.55, 14, 0],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(255,210,0,0)', 0.15, 'rgba(255,214,70,0.35)', 0.35, 'rgba(255,183,0,0.55)',
          0.55, 'rgba(240,127,0,0.6)', 0.8, 'rgba(224,48,30,0.65)', 1, 'rgba(160,20,40,0.7)'],
      },
    });
    // 期間中だが、いまは作業時間外のもの（灰色でうっすら）
    map.addLayer({
      id: 'koji-off-line', type: 'line', source: SRC, filter: ['all', isLine, off],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#8a8f94', 'line-width': zoomW(1.2, 3), 'line-opacity': 0.45, 'line-offset': shift(2, 8) },
    });
    map.addLayer({
      id: 'koji-off-pt', type: 'circle', source: SRC, filter: ['all', isPt, off],
      paint: { 'circle-color': '#8a8f94', 'circle-radius': zoomW(1.5, 4), 'circle-opacity': 0.45 },
    });
    // いま作業中のもの（白い縁取り＋ふさぎ具合の色）
    map.addLayer({
      id: 'koji-casing', type: 'line', source: SRC, filter: ['all', isLine, on],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': zoomWL(4.5, 14), 'line-offset': shift(2, 8) },
    });
    map.addLayer({
      id: 'koji-line', type: 'line', source: SRC, filter: ['all', isLine, on],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExpr, 'line-width': zoomWL(2.8, 10), 'line-offset': shift(2, 8) },
    });
    map.addLayer({
      id: 'koji-pt', type: 'circle', source: SRC, filter: ['all', isPt, on, ['!', approx]],
      paint: {
        'circle-color': colorExpr,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['*', WIDTH_BY_LEVEL, 3], 16, ['*', WIDTH_BY_LEVEL, 7]],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
      },
    });
    // 位置が目安の工事は、道路の上に置かず白抜きの丸にする
    map.addLayer({
      id: 'koji-approx', type: 'circle', source: SRC, filter: ['all', isPt, on, approx],
      paint: {
        'circle-color': 'rgba(255,255,255,0.75)', 'circle-radius': zoomW(4, 9),
        'circle-stroke-color': colorExpr, 'circle-stroke-width': 2.5,
      },
    });

    for (const id of ['koji-line', 'koji-pt', 'koji-approx', 'koji-off-line', 'koji-off-pt']) {
      map.on('click', id, (e) => openPopup(e));
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    added = true;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function popupHtml(p) {
    const lv = levelInfo(p.level || laneLevel(p));
    const jam = jamNote(p, new Date(timeMs + 9 * 3600 * 1000).getUTCHours());
    const working = Number(p.st) === 2;
    return `<div class="kj-pop">
      <div class="kj-pop-title">${esc(p.title || '工事')}</div>
      <div class="kj-pop-lv"><i style="background:${lv.color}"></i>${lv.label}${jam && working ? `・<b>${jam}</b>` : ''}</div>
      <div class="kj-pop-row">${working ? '' : '<b>いまは作業時間外</b>／'}${esc(windowLabel(p.timeWindow))}</div>
      ${p.roadSide ? `<div class="kj-pop-row">規制する側: <b>${esc(sideLabel(p.roadSide))}</b><span class="kj-dim">（推定）</span></div>` : ''}
      ${p.laneSummary ? `<div class="kj-pop-row">${esc(p.laneSummary)}</div>` : ''}
      <div class="kj-pop-row kj-dim">${esc(periodLabel(p))}</div>
      ${p.placement === 'approx' ? '<div class="kj-warn">この工事は位置が目安です</div>' : ''}
      <div class="kj-pop-note">予定に基づく目安。実際の通行は現地の標識・警察の指示に従ってください。</div>
    </div>`;
  }

  function openPopup(e) {
    const f = e.features && e.features[0];
    if (!f) return;
    popup?.remove();
    popup = new maplibregl.Popup({ maxWidth: '290px', closeButton: true })
      .setLngLat(e.lngLat).setHTML(popupHtml(f.properties)).addTo(map);
  }

  function bounds() {
    const b = map.getBounds();
    const padLat = (b.getNorth() - b.getSouth()) * 0.15;
    const padLng = (b.getEast() - b.getWest()) * 0.15;
    return {
      minLat: b.getSouth() - padLat, maxLat: b.getNorth() + padLat,
      minLng: b.getWest() - padLng, maxLng: b.getEast() + padLng,
    };
  }

  function draw() {
    if (!data || !added) { onStatus?.({ error: loadError }); return; }
    const b = bounds();
    const shown = [];   // 画面の中（期間中のもの）
    const heat = [];
    let workingHere = 0;
    for (const f of data.features) {
      if (!intersects(f.geometry, b)) continue;
      const d = toDisplay(f, timeMs);
      if (d.properties.st === 0) continue;
      shown.push(d);
      if (d.properties.st === 2) {
        workingHere += 1;
        for (const c of samplePoints(d.geometry)) {
          heat.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { w: HEAT_WEIGHT[d.properties.level] ?? 0.3 } });
        }
      }
    }
    map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: shown });
    map.getSource(HEAT_SRC)?.setData({ type: 'FeatureCollection', features: heat });
    onStatus?.({
      shown: workingHere,
      total: selectActive(data.features, timeMs).length,
      counts: countByLevel(shown.filter((f) => f.properties.st === 2)),
      fetchedAt: data.fetchedAt,
      dataset: data.source?.dataset || '',
      error: loadError,
    });
  }

  function setLayerVisibility(on2) {
    if (!added) return;
    for (const id of LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on2 ? 'visible' : 'none');
    }
  }

  async function setVisible(next) {
    visible = next;
    if (!next) { popup?.remove(); setLayerVisibility(false); return; }
    onStatus?.({ loading: true });
    await load();
    try {
      addLayers();
    } catch (e) {
      loadError = `工事の地図を作れませんでした（${e.message}）`;
      onStatus?.({ error: loadError });
      return;
    }
    setLayerVisibility(true);
    draw();
  }

  function setTime(ms) { timeMs = ms; if (visible) draw(); }
  function refresh() { if (visible) draw(); }

  return { setVisible, setTime, refresh, isVisible: () => visible };
}

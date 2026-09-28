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

/** 地図に層を足せるようになるまで、実際に足してみて確かめる。
    MapLibre は画面が裏（別タブ・バックグラウンド）にいる間は描画が止まり、
    「読み込み終わった」の合図も来ない。合図を待つのではなく、できるまで0.3秒おきに試し、
    画面が表に戻ったときにもすぐ試す（裏にいる間は何回でも待つ）。 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const SRC = 'koji';
const HEAT_SRC = 'koji-heat';
const LAYERS = ['xw-band', 'xw-tunnel', 'koji-heat', 'koji-off-line', 'koji-off-pt', 'koji-casing', 'koji-line',
  'koji-flow-fade--1', 'koji-flow-dash--1', 'koji-flow-fade-1', 'koji-flow-dash-1',
  'koji-arrow--1-0', 'koji-arrow--1-1', 'koji-arrow-1-0', 'koji-arrow-1-1', 'koji-arrow-far--1', 'koji-arrow-far-1',
  'koji-pt', 'koji-approx', 'koji-ends'];
const ENDS_SRC = 'koji-ends';
const XW_SRC = 'koji-xw';

// 道の持ち主（国道・都道・区道）と区の境。工事マップ本家 public/roadowner.js の移植。
// 元データ: 国土地理院 最適化ベクトルタイル。既定は非表示（本家と同じ）。
const GSI_VT = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf';
export const OWNERS = [
  { key: 'kokudo', rdctg: '国道', label: '国道', color: '#2563eb', width: [1.6, 7], minzoom: 8 },
  { key: 'todo', rdctg: '都道府県道', label: '都道', color: '#059669', width: [1.2, 5.5], minzoom: 10 },
  { key: 'kudo', rdctg: '市区町村道等', label: '区道など', color: '#c026d3', width: [0.6, 2.2], minzoom: 14, opacity: 0.45 },
];
const OWNER_LAYERS = OWNERS.map((o) => `owner-${o.key}`).concat(['ward-bdry-casing', 'ward-bdry']);
// 23区の名前の位置（本家 roadowner.js より）
const WARDS = [
  ['千代田区', 139.7387, 35.6894], ['中央区', 139.7821, 35.6779], ['港区', 139.7275, 35.6552], ['新宿区', 139.7097, 35.6995],
  ['文京区', 139.739, 35.72], ['台東区', 139.7859, 35.7205], ['墨田区', 139.8115, 35.7162], ['江東区', 139.8072, 35.6766],
  ['品川区', 139.7143, 35.613], ['目黒区', 139.6933, 35.6392], ['大田区', 139.7073, 35.5798], ['世田谷区', 139.6284, 35.638],
  ['渋谷区', 139.683, 35.6679], ['中野区', 139.6707, 35.7195], ['杉並区', 139.6227, 35.6928], ['豊島区', 139.692, 35.7362],
  ['北区', 139.7294, 35.7758], ['荒川区', 139.7636, 35.7451], ['板橋区', 139.6828, 35.7819], ['練馬区', 139.6209, 35.7619],
  ['足立区', 139.8024, 35.7854], ['葛飾区', 139.8492, 35.7417], ['江戸川区', 139.8724, 35.6987],
];
// 白い点線を車の向きへ流す模様（本家と同じ）
const DASH_STEPS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

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
  let roadsOn = false;
  let flowTimer = null;
  const wardMarkers = [];

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
    map.addSource(SRC, { type: 'geojson', data: empty, lineMetrics: true, attribution: '東京都建設局 路上工事情報(CC BY 4.0) / © OpenStreetMap contributors' });
    map.addSource(HEAT_SRC, { type: 'geojson', data: empty });
    map.addSource(ENDS_SRC, { type: 'geojson', data: empty });

    // 高速道路（首都高など）は薄い帯。工事はすべて下道（本家と同じ）
    map.addSource(XW_SRC, { type: 'geojson', data: './data/expressways.geojson', attribution: '国土地理院' });
    map.addLayer({
      id: 'xw-band', type: 'line', source: XW_SRC, filter: ['==', ['get', 'tunnel'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#cfd7e6', 'line-width': zoomW(3, 14) },
    });
    map.addLayer({
      id: 'xw-tunnel', type: 'line', source: XW_SRC, filter: ['==', ['get', 'tunnel'], 1],
      paint: { 'line-color': '#cfd7e6', 'line-dasharray': [1, 1], 'line-width': zoomW(1.5, 5) },
    });

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

    // 車の向きを感覚的に: 片側だけの工事の線を「うすい→こい」にし、白い点線を車の向きに流す。
    // 左側通行なので、線の進む向きの左(side -1)の車線は線と同じ向き、右(+1)は逆向き（本家と同じ）
    const fade = (fwd) => (fwd
      ? ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0.88)', 0.55, 'rgba(255,255,255,0.35)', 1, 'rgba(255,255,255,0)']
      : ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 0.45, 'rgba(255,255,255,0.35)', 1, 'rgba(255,255,255,0.88)']);
    for (const [sign, fwd] of [[-1, true], [1, false]]) {
      const f = ['all', isLine, on, ['==', ['get', 'side'], sign]];
      map.addLayer({
        id: `koji-flow-fade-${sign}`, type: 'line', source: SRC, filter: f,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-gradient': fade(fwd), 'line-width': zoomWL(2.8, 10), 'line-offset': shift(2, 8) },
      });
      map.addLayer({
        id: `koji-flow-dash-${sign}`, type: 'line', source: SRC, filter: f, minzoom: 11.5,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': zoomWL(1.6, 4.5), 'line-offset': shift(2, 8), 'line-dasharray': [0, 4, 3], 'line-opacity': 0.95 },
      });
    }
    startFlow();

    // ふさがれる車線を走る車の向きの矢印（本家と同じ置き方）
    addArrowImages();
    const arrowOffset = (sign) => ['interpolate', ['linear'], ['zoom'], 11, ['literal', [0, 2 * sign]], 16, ['literal', [0, 8 * sign]]];
    for (const [sign, icon] of [[-1, 'koji-arrow-fwd'], [1, 'koji-arrow-back']]) {
      for (const [short, placement] of [[0, 'line'], [1, 'line-center']]) {
        map.addLayer({
          id: `koji-arrow-${sign}-${short}`, type: 'symbol', source: SRC, minzoom: 13,
          filter: ['all', isLine, on, ['==', ['get', 'side'], sign], ['==', ['get', 'isLine'], short ? 0 : 1]],
          layout: {
            'symbol-placement': placement, 'symbol-spacing': 90, 'icon-image': icon,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1.1],
            'icon-rotation-alignment': 'map', 'icon-keep-upright': false,
            'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': arrowOffset(sign),
          },
        });
      }
    }
    // 遠目では、片側だけの工事ごとに真ん中へ小さな矢印を1つ
    for (const [sign, icon] of [[-1, 'koji-arrow-fwd'], [1, 'koji-arrow-back']]) {
      map.addLayer({
        id: `koji-arrow-far-${sign}`, type: 'symbol', source: SRC, minzoom: 12, maxzoom: 13,
        filter: ['all', isLine, on, ['==', ['get', 'side'], sign]],
        layout: {
          'symbol-placement': 'line-center', 'icon-image': icon,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 13, 0.7],
          'icon-rotation-alignment': 'map', 'icon-keep-upright': false,
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': arrowOffset(sign),
        },
      });
    }
    // 工事区間の両端（白い点）
    map.addLayer({
      id: 'koji-ends', type: 'circle', source: ENDS_SRC, minzoom: 11.5,
      paint: { 'circle-color': '#ffffff', 'circle-radius': zoomW(2, 5), 'circle-stroke-color': '#1d2024', 'circle-stroke-width': 1.5 },
    });
    // 道の持ち主と区の境（既定は非表示・本家と同じ。工事の線より下に入れる）
    addOwnerLayers();

    for (const id of ['koji-line', 'koji-pt', 'koji-approx', 'koji-off-line', 'koji-off-pt']) {
      map.on('click', id, (e) => openPopup(e));
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    added = true;
  }

  /** 矢印の画像（濃い矢印に白いふち）。本家と同じ形 */
  function addArrowImages() {
    for (const [name, dir] of [['koji-arrow-fwd', 1], ['koji-arrow-back', -1]]) {
      if (map.hasImage(name)) continue;
      const w = 64, h = 36, c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.translate(w / 2, h / 2); g.scale(dir, 1);
      const path = () => {
        g.beginPath();
        g.moveTo(-22, -4); g.lineTo(4, -4); g.lineTo(4, -12); g.lineTo(24, 0); g.lineTo(4, 12); g.lineTo(4, 4); g.lineTo(-22, 4); g.closePath();
      };
      g.lineJoin = 'round';
      path(); g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.stroke();
      path(); g.fillStyle = '#1d2024'; g.fill();
      map.addImage(name, g.getImageData(0, 0, w, h), { pixelRatio: 2 });
    }
  }

  /** 白い点線を車の向きへ流す。動きを減らす設定の人には流さない（本家と同じ） */
  function startFlow() {
    if (flowTimer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let i = 0;
    flowTimer = setInterval(() => {
      if (document.hidden || !visible || !map.getLayer('koji-flow-dash--1')) return;
      i = (i + 1) % DASH_STEPS.length;
      map.setPaintProperty('koji-flow-dash--1', 'line-dasharray', DASH_STEPS[i]);
      map.setPaintProperty('koji-flow-dash-1', 'line-dasharray', DASH_STEPS[(DASH_STEPS.length - i) % DASH_STEPS.length]);
    }, 70);
  }

  /** 道の持ち主（国道・都道・区道）と区の境。最初は見えない */
  function addOwnerLayers() {
    map.addSource('gsi-v', { type: 'vector', tiles: [GSI_VT], minzoom: 4, maxzoom: 16, attribution: '国土地理院' });
    map.addSource('gsi-bdry', { type: 'vector', tiles: [GSI_VT], minzoom: 11, maxzoom: 14 });
    const hide = { visibility: 'none' };
    const before = 'koji-heat';
    for (const o of [...OWNERS].reverse()) {     // 細い道を下に
      map.addLayer({
        id: `owner-${o.key}`, type: 'line', source: 'gsi-v', 'source-layer': 'RdCL', minzoom: o.minzoom,
        filter: ['all', ['==', ['get', 'vt_rdctg'], o.rdctg], ['!=', ['get', 'vt_motorway'], '1']],
        layout: { ...hide, 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': o.color, 'line-opacity': o.opacity ?? 0.72,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, o.width[0], 17, o.width[1]],
        },
      }, before);
    }
    const bdry = ['in', ['get', 'vt_code'], ['literal', ['1211', '1212', 1211, 1212]]];
    map.addLayer({
      id: 'ward-bdry-casing', type: 'line', source: 'gsi-bdry', 'source-layer': 'AdmBdry', filter: bdry, layout: hide,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7] },
    }, before);
    map.addLayer({
      id: 'ward-bdry', type: 'line', source: 'gsi-bdry', 'source-layer': 'AdmBdry', filter: bdry, layout: hide,
      paint: { 'line-color': '#3f3f46', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.6], 'line-dasharray': [3, 1.5, 1, 1.5] },
    }, before);
    for (const [name, lng, lat] of WARDS) {
      const e = document.createElement('div');
      e.className = 'ward-label';
      e.textContent = name;
      e.style.display = 'none';
      wardMarkers.push(new maplibregl.Marker({ element: e }).setLngLat([lng, lat]).addTo(map));
    }
  }

  /** 道路の色分けの表示/非表示（既定は非表示） */
  function setRoads(next) {
    roadsOn = next;
    for (const id of OWNER_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', roadsOn && visible ? 'visible' : 'none');
    }
    for (const m of wardMarkers) m.getElement().style.display = roadsOn && visible ? '' : 'none';
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
    const ends = [];
    let workingHere = 0;
    for (const f of data.features) {
      if (!intersects(f.geometry, b)) continue;
      const d = toDisplay(f, timeMs);
      if (d.properties.st === 0) continue;
      shown.push(d);
      if (d.properties.st === 2) {
        workingHere += 1;
        if (d.geometry.type === 'LineString') {
          const c = d.geometry.coordinates;
          ends.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c[0] }, properties: {} });
          ends.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c[c.length - 1] }, properties: {} });
        }
        for (const c of samplePoints(d.geometry)) {
          heat.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { w: HEAT_WEIGHT[d.properties.level] ?? 0.3 } });
        }
      }
    }
    map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: shown });
    map.getSource(HEAT_SRC)?.setData({ type: 'FeatureCollection', features: heat });
    map.getSource(ENDS_SRC)?.setData({ type: 'FeatureCollection', features: ends });
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
    setRoads(roadsOn);
  }

  async function setVisible(next) {
    visible = next;
    if (!next) { popup?.remove(); setLayerVisibility(false); return; }
    onStatus?.({ loading: true });
    await load();
    const ok = await ensureLayers();
    if (!ok) { onStatus?.({ error: loadError }); return; }
    setLayerVisibility(true);
    draw();
  }

  /** 足せるまで0.3秒おきに試す。
      裏にいる間は何度でも待つ（画面が裏だと MapLibre の準備が進まないため）。
      表にいるのに12秒たっても足せないときだけ、本当の失敗として画面に出す。 */
  async function ensureLayers() {
    let failsWhileVisible = 0;
    while (visible && !added) {
      try {
        addLayers();
        return true;
      } catch (e) {
        if (!document.hidden) {
          failsWhileVisible += 1;
          if (failsWhileVisible > 40) {
            loadError = `工事の地図を作れませんでした（${e.message}）`;
            return false;
          }
        }
        await sleep(300);
      }
    }
    return added;
  }

  function setTime(ms) { timeMs = ms; if (visible) draw(); }
  function refresh() { if (visible) draw(); }

  return {
    setVisible, setTime, refresh,
    setRoads: (v) => setRoads(v),
    isRoadsOn: () => roadsOn,
    isVisible: () => visible,
  };
}

// tools/js/koji-layer.js — 工事マップの地図の層（MapLibre GL）
//
// 描き方は工事マップ本家（ハッカソン/osanpo-safety の public/radar.js）をそのまま移植:
//   遠目は「雨雲」のような熱の濃淡、近づくと 白い縁取り＋色の線（太さはふさぎ具合）、
//   どちら側の車線かで線を左右へ寄せ、車の向きの矢印と流れる点線、工事区間の両端に白い点、
//   点は丸・位置が目安のものは白抜きの丸、期間中だが時間外のものは灰色でうっすら。
//   高速道路は薄い帯、道の持ち主（国道・都道・区道）と区の境は押したときだけ。
// 画面の中身（一覧・凡例・時刻）は koji-ui.js。材料づくりは koji-data.js。
import { MODES, PLACES, OWNERS_DEF, WARDS_DEF } from './koji-data.js';

const SRC = 'koji';
const HEAT_SRC = 'koji-heat';
const ENDS_SRC = 'koji-ends';
const XW_SRC = 'koji-xw';

// 見た目の決め方（本家と同じ値）
const WIDTH_BY_LEVEL = ['match', ['get', 'level'], 'closed', 2, 'alternating', 1.6, 'half', 1.3, 1];
const zoomW = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
const zoomWL = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, ['*', WIDTH_BY_LEVEL, a], 16, ['*', WIDTH_BY_LEVEL, b]];
const shift = (a, b) => ['interpolate', ['linear'], ['zoom'], 11, ['*', ['get', 'side'], a], 16, ['*', ['get', 'side'], b]];
const isLine = ['==', ['geometry-type'], 'LineString'];
const isPt = ['==', ['geometry-type'], 'Point'];
const onNow = ['==', ['get', 'st'], 2];
const offNow = ['==', ['get', 'st'], 1];
const approx = ['==', ['get', 'placement'], 'approx'];
const colorExprFor = (modeKey) => {
  const m = MODES[modeKey] || MODES.level;
  return ['match', ['get', m.prop], ...m.items.flatMap((k) => [k.key, k.color]), '#888'];
};

// 白い点線を車の向きへ流す模様
const DASH_STEPS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

const GSI_VT = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf';
const OWNER_LAYERS = OWNERS_DEF.map((o) => `owner-${o.key}`).concat(['ward-bdry-casing', 'ward-bdry']);
const MAIN_LAYERS = ['xw-band', 'xw-tunnel', 'koji-heat', 'koji-off-line', 'koji-off-pt', 'koji-casing', 'koji-line',
  'koji-flow-fade--1', 'koji-flow-dash--1', 'koji-flow-fade-1', 'koji-flow-dash-1',
  'koji-arrow--1-0', 'koji-arrow--1-1', 'koji-arrow-1-0', 'koji-arrow-1-1', 'koji-arrow-far--1', 'koji-arrow-far-1',
  'koji-pt', 'koji-approx', 'koji-ends'];

export function createKojiLayer(map, { onClick } = {}) {
  let added = false;
  let visible = false;
  let roadsOn = false;
  let flowTimer = null;
  let modeKey = 'level';
  const ownerShown = new Set([...OWNERS_DEF.map((o) => o.key), 'bdry']);
  const wardMarkers = [];
  const placeMarkers = [];

  /** 層を足せる状態か（画面が裏だと MapLibre の準備が進まないので、足してみて確かめる） */
  function canAdd() {
    try { return map.isStyleLoaded() || !!(map.style && map.style._loaded); } catch { return false; }
  }

  function addLayers() {
    if (added) return;
    if (!canAdd()) throw new Error('地図の読み込みがまだ終わっていません');
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource(SRC, {
      type: 'geojson', data: empty, lineMetrics: true,
      attribution: '東京都建設局 路上工事情報(CC BY 4.0) / © OpenStreetMap contributors',
    });
    map.addSource(HEAT_SRC, { type: 'geojson', data: empty });
    map.addSource(ENDS_SRC, { type: 'geojson', data: empty });

    // 高速道路（首都高など）は薄い帯。工事はすべて下道
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

    // 遠目で見たときの「雨雲」
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
    // 期間中だが、いまは作業時間外
    map.addLayer({
      id: 'koji-off-line', type: 'line', source: SRC, filter: ['all', isLine, offNow],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#8a8f94', 'line-width': zoomW(1.2, 3), 'line-opacity': 0.45, 'line-offset': shift(2, 8) },
    });
    map.addLayer({
      id: 'koji-off-pt', type: 'circle', source: SRC, filter: ['all', isPt, offNow],
      paint: { 'circle-color': '#8a8f94', 'circle-radius': zoomW(1.5, 4), 'circle-opacity': 0.45 },
    });
    // いま作業中
    map.addLayer({
      id: 'koji-casing', type: 'line', source: SRC, filter: ['all', isLine, onNow],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': zoomWL(4.5, 14), 'line-offset': shift(2, 8) },
    });
    map.addLayer({
      id: 'koji-line', type: 'line', source: SRC, filter: ['all', isLine, onNow],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExprFor(modeKey), 'line-width': zoomWL(2.8, 10), 'line-offset': shift(2, 8) },
    });
    // 車の向き: うすい→こい＋流れる白い点線
    const fade = (fwd) => (fwd
      ? ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0.88)', 0.55, 'rgba(255,255,255,0.35)', 1, 'rgba(255,255,255,0)']
      : ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 0.45, 'rgba(255,255,255,0.35)', 1, 'rgba(255,255,255,0.88)']);
    for (const [sign, fwd] of [[-1, true], [1, false]]) {
      const f = ['all', isLine, onNow, ['==', ['get', 'side'], sign]];
      map.addLayer({
        id: `koji-flow-fade-${sign}`, type: 'line', source: SRC, filter: f,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-gradient': fade(fwd), 'line-width': zoomWL(2.8, 10), 'line-offset': shift(2, 8) },
      });
      map.addLayer({
        id: `koji-flow-dash-${sign}`, type: 'line', source: SRC, filter: f, minzoom: 11.5,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff', 'line-width': zoomWL(1.6, 4.5), 'line-offset': shift(2, 8),
          'line-dasharray': [0, 4, 3], 'line-opacity': 0.95,
        },
      });
    }
    startFlow();

    // ふさがれる車線を走る車の向きの矢印
    addArrowImages();
    const arrowOffset = (sign) => ['interpolate', ['linear'], ['zoom'], 11, ['literal', [0, 2 * sign]], 16, ['literal', [0, 8 * sign]]];
    for (const [sign, icon] of [[-1, 'koji-arrow-fwd'], [1, 'koji-arrow-back']]) {
      for (const [short, placement] of [[0, 'line'], [1, 'line-center']]) {
        map.addLayer({
          id: `koji-arrow-${sign}-${short}`, type: 'symbol', source: SRC, minzoom: 13,
          filter: ['all', isLine, onNow, ['==', ['get', 'side'], sign], ['==', ['get', 'isLine'], short ? 0 : 1]],
          layout: {
            'symbol-placement': placement, 'symbol-spacing': 90, 'icon-image': icon,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1.1],
            'icon-rotation-alignment': 'map', 'icon-keep-upright': false,
            'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': arrowOffset(sign),
          },
        });
      }
    }
    for (const [sign, icon] of [[-1, 'koji-arrow-fwd'], [1, 'koji-arrow-back']]) {
      map.addLayer({
        id: `koji-arrow-far-${sign}`, type: 'symbol', source: SRC, minzoom: 12, maxzoom: 13,
        filter: ['all', isLine, onNow, ['==', ['get', 'side'], sign]],
        layout: {
          'symbol-placement': 'line-center', 'icon-image': icon,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 13, 0.7],
          'icon-rotation-alignment': 'map', 'icon-keep-upright': false,
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': arrowOffset(sign),
        },
      });
    }
    // 点・位置が目安の白抜きの丸・工事区間の両端
    map.addLayer({
      id: 'koji-pt', type: 'circle', source: SRC, filter: ['all', isPt, onNow, ['!', approx]],
      paint: {
        'circle-color': colorExprFor(modeKey),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['*', WIDTH_BY_LEVEL, 3], 16, ['*', WIDTH_BY_LEVEL, 7]],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: 'koji-approx', type: 'circle', source: SRC, filter: ['all', isPt, onNow, approx],
      paint: {
        'circle-color': 'rgba(255,255,255,0.75)', 'circle-radius': zoomW(4, 9),
        'circle-stroke-color': colorExprFor(modeKey), 'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'koji-ends', type: 'circle', source: ENDS_SRC, minzoom: 11.5,
      paint: { 'circle-color': '#ffffff', 'circle-radius': zoomW(2, 5), 'circle-stroke-color': '#1d2024', 'circle-stroke-width': 1.5 },
    });

    addOwnerLayers();
    addPlaceLabels();

    for (const id of ['koji-line', 'koji-pt', 'koji-approx', 'koji-off-line', 'koji-off-pt']) {
      map.on('click', id, (e) => {
        const f = e.features && e.features[0];
        if (f) onClick?.(f, e.lngLat);
      });
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    added = true;
  }

  /** 矢印の画像（濃い矢印に白いふち） */
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

  /** 白い点線を車の向きへ流す。動きを減らす設定の人には流さない */
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

  /** 地名ラベル（主な駅・街） */
  function addPlaceLabels() {
    for (const [ja, en, lng, lat] of PLACES) {
      const e = document.createElement('div');
      e.className = 'koji-place';
      e.innerHTML = `<b>${ja}</b><span>${en}</span>`;
      e.style.display = 'none';
      placeMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map));
    }
  }

  /** 道の持ち主と区の境（最初は見えない） */
  function addOwnerLayers() {
    map.addSource('gsi-v', { type: 'vector', tiles: [GSI_VT], minzoom: 4, maxzoom: 16, attribution: '国土地理院' });
    map.addSource('gsi-bdry', { type: 'vector', tiles: [GSI_VT], minzoom: 11, maxzoom: 14 });
    const hide = { visibility: 'none' };
    const before = 'koji-heat';
    for (const o of [...OWNERS_DEF].reverse()) {     // 細い道を下に
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
      paint: {
        'line-color': '#3f3f46', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.6],
        'line-dasharray': [3, 1.5, 1, 1.5],
      },
    }, before);
    for (const [name, lng, lat] of WARDS_DEF) {
      const e = document.createElement('div');
      e.className = 'koji-ward';
      e.textContent = name;
      e.style.display = 'none';
      wardMarkers.push(new maplibregl.Marker({ element: e }).setLngLat([lng, lat]).addTo(map));
    }
  }

  function applyRoads() {
    for (const o of OWNERS_DEF) {
      const id = `owner-${o.key}`;
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', roadsOn && visible && ownerShown.has(o.key) ? 'visible' : 'none');
    }
    const bd = roadsOn && visible && ownerShown.has('bdry');
    for (const id of ['ward-bdry-casing', 'ward-bdry']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', bd ? 'visible' : 'none');
    }
    for (const m of wardMarkers) m.getElement().style.display = bd ? '' : 'none';
  }

  function setLayersVisible(nextVisible) {
    for (const id of MAIN_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', nextVisible ? 'visible' : 'none');
    }
    for (const m of placeMarkers) m.getElement().style.display = nextVisible ? '' : 'none';
    applyRoads();
  }

  return {
    canAdd,
    addLayers,
    isAdded: () => added,
    setVisible(next) {
      visible = next;
      if (added) setLayersVisible(next);
    },
    setData({ shown, heat, ends }) {
      map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: shown });
      map.getSource(HEAT_SRC)?.setData({ type: 'FeatureCollection', features: heat });
      map.getSource(ENDS_SRC)?.setData({ type: 'FeatureCollection', features: ends });
    },
    setColorMode(next) {
      modeKey = next;
      if (!added) return;
      const expr = colorExprFor(modeKey);
      if (map.getLayer('koji-line')) map.setPaintProperty('koji-line', 'line-color', expr);
      if (map.getLayer('koji-pt')) map.setPaintProperty('koji-pt', 'circle-color', expr);
      if (map.getLayer('koji-approx')) map.setPaintProperty('koji-approx', 'circle-stroke-color', expr);
    },
    setRoads(next) { roadsOn = next; applyRoads(); },
    isRoadsOn: () => roadsOn,
    toggleOwner(key) {
      if (ownerShown.has(key)) ownerShown.delete(key); else ownerShown.add(key);
      applyRoads();
      return ownerShown.has(key);
    },
    isOwnerShown: (key) => ownerShown.has(key),
  };
}

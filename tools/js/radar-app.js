// tools/js/radar-app.js — 雨雲レーダー画面の組み立て（DOM / Leaflet 側）
//
// 材料づくりは radar-data.js（純関数・テストあり）。ここは配線だけ。
// 出典表示「出典：気象庁」は利用条件なので必ず地図に出す。
import {
  TARGET_TIMES_OBS, TARGET_TIMES_FCST,
  buildFrames, tileUrl, frameLabel, frameClock,
  searchPlaces, PRESET_PLACES,
} from './radar-data.js';

const VIEW_KEY = 'radarLastView';      // 最後に見ていた場所（次に開いたとき同じ場所から）
const DEFAULT_VIEW = { lat: 35.5494, lon: 139.7798, zoom: 11 }; // 羽田
const MAX_LAYERS = 12;                 // 端末のメモリを食わないよう、持っておくコマ数の上限
const PLAY_INTERVAL_MS = 450;

const el = (id) => document.getElementById(id);

let map = null;
let frames = [];
let index = 0;
let playTimer = null;
let hereMarker = null;
const layers = new Map();  // frameIndex → L.tileLayer

// --- 地図 -----------------------------------------------------------------
function readView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom)) return v;
  } catch { /* 壊れていたら既定へ */ }
  return DEFAULT_VIEW;
}
function saveView() {
  try {
    const c = map.getCenter();
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
  } catch { /* 保存できなくても動作に影響なし */ }
}

// 地図を触り終わったタイミングで保存する。
// Leaflet の moveend / zoomend は、この画面では発火しなかった(dev実機で計測して確認)。
// 指を離した・ホイールを止めた、という操作そのものを拾うほうが確実。
let saveTimer = null;
function saveViewSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveView, 400);
}

function createMap() {
  const v = readView();
  map = L.map('radar-map', { zoomControl: true }).setView([v.lat, v.lon], v.zoom);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18, subdomains: 'abcd',
    attribution: '© OpenStreetMap contributors © CARTO ｜ 雨雲：出典 気象庁',
  }).addTo(map);
  const c = map.getContainer();
  for (const ev of ['pointerup', 'touchend', 'mouseup', 'wheel']) {
    c.addEventListener(ev, saveViewSoon, { passive: true });
  }
}

// --- 雨雲のコマ -----------------------------------------------------------
function layerFor(i) {
  if (layers.has(i)) return layers.get(i);
  const f = frames[i];
  const layer = L.tileLayer(tileUrl(f, '{z}', '{x}', '{y}'), {
    opacity: 0,
    maxZoom: 18,
    maxNativeZoom: 10,   // 実データは約1kmメッシュ。これ以上は引き伸ばして見せる
    zIndex: 400,
    crossOrigin: true,
  });
  layer.addTo(map);
  layers.set(i, layer);
  // 遠いコマから捨てる（端末のメモリを食わないため）
  if (layers.size > MAX_LAYERS) {
    const far = [...layers.keys()].sort((a, b) => Math.abs(b - index) - Math.abs(a - index))[0];
    if (far !== index) { map.removeLayer(layers.get(far)); layers.delete(far); }
  }
  return layer;
}

function show(i) {
  if (!frames.length) return;
  index = Math.max(0, Math.min(frames.length - 1, i));
  const cur = layerFor(index);
  for (const [k, layer] of layers) layer.setOpacity(k === index ? 0.72 : 0);
  cur.setOpacity(0.72);
  renderTimeUi();
  // 次のコマを先に読み込んでおく（動かしたときのカクつきを減らす）
  if (index + 1 < frames.length) layerFor(index + 1).setOpacity(0);
}

function renderTimeUi() {
  const f = frames[index];
  const nowMs = (frames.find((x) => x.isLatestObs) || {}).timeMs ?? null;
  el('radar-slider').value = String(index);
  el('radar-clock').textContent = frameClock(f);
  el('radar-rel').textContent = frameLabel(f, nowMs);
  el('radar-kind').textContent = f.kind === 'fcst' ? 'この先の予想' : '実際に降った雨';
  el('radar-kind').className = f.kind === 'fcst' ? 'kind fcst' : 'kind obs';
}

function setPlaying(on) {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  el('radar-play').textContent = on ? '⏸ とめる' : '▶ 動かす';
  if (!on) return;
  playTimer = setInterval(() => {
    show(index + 1 >= frames.length ? 0 : index + 1);
  }, PLAY_INTERVAL_MS);
}

// --- 場所えらび -----------------------------------------------------------
let areaCoords = null;

async function loadAreaCoords() {
  if (areaCoords) return areaCoords;
  try {
    const res = await fetch('../js/data/area-coords.json');
    areaCoords = res.ok ? await res.json() : {};
  } catch { areaCoords = {}; }
  return areaCoords;
}

function goTo(lat, lon, zoom = 12, label = '') {
  map.setView([lat, lon], zoom);
  saveView(); // 選んだ場所は、その場で覚える(次に開いたときここから)
  if (label) {
    el('radar-place-label').textContent = label;
    el('radar-place-label').hidden = false;
  }
  closePlacePanel();
}

function renderPresets() {
  const box = el('radar-presets');
  box.innerHTML = '';
  for (const p of PRESET_PLACES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'place-chip';
    b.textContent = p.name;
    b.addEventListener('click', () => goTo(p.lat, p.lon, 12, p.name));
    box.appendChild(b);
  }
}

async function runSearch(q) {
  const box = el('radar-results');
  const coords = await loadAreaCoords();
  const hits = searchPlaces(q, coords, 20);
  box.innerHTML = '';
  if (!q.trim()) return;
  if (hits.length === 0) {
    box.innerHTML = '<div class="no-hit">見つかりませんでした</div>';
    return;
  }
  for (const h of hits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'place-row';
    b.textContent = h.name;
    b.addEventListener('click', () => goTo(h.lat, h.lon, 13, h.name));
    box.appendChild(b);
  }
}

function useCurrentPosition() {
  const status = el('radar-geo-status');
  if (!navigator.geolocation) { status.textContent = 'この端末では現在地を使えません'; return; }
  status.textContent = '現在地を確認中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      status.textContent = '';
      if (hereMarker) map.removeLayer(hereMarker);
      hereMarker = L.circleMarker([latitude, longitude], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#e5443a', fillOpacity: 1, zIndex: 500,
      }).addTo(map);
      goTo(latitude, longitude, 13, 'いまの場所');
    },
    (err) => {
      status.textContent = err && err.code === 1
        ? '現在地の利用が許可されていません'
        : '現在地を取得できませんでした';
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
  );
}

function openPlacePanel() {
  el('radar-place-panel').classList.add('open');
  el('radar-search').focus();
}
function closePlacePanel() {
  el('radar-place-panel').classList.remove('open');
}

// --- 起動 -----------------------------------------------------------------
async function loadFrames() {
  const [obs, fcst] = await Promise.all([
    fetch(TARGET_TIMES_OBS, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(TARGET_TIMES_FCST, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  return buildFrames(obs, fcst);
}

async function start() {
  createMap();
  renderPresets();

  el('radar-play').addEventListener('click', () => setPlaying(!playTimer));
  el('radar-slider').addEventListener('input', (e) => {
    setPlaying(false);
    show(Number(e.target.value));
  });
  el('radar-place-btn').addEventListener('click', openPlacePanel);
  el('radar-place-close').addEventListener('click', closePlacePanel);
  el('radar-here').addEventListener('click', useCurrentPosition);
  let t = null;
  el('radar-search').addEventListener('input', (e) => {
    clearTimeout(t);
    const q = e.target.value;
    t = setTimeout(() => runSearch(q), 150);
  });

  frames = await loadFrames();
  if (frames.length === 0) {
    el('radar-error').textContent = '雨雲データを取得できませんでした。少し時間をおいて開き直してください。';
    el('radar-error').hidden = false;
    el('radar-bar').hidden = true;
    return;
  }
  el('radar-slider').max = String(frames.length - 1);
  const latest = frames.findIndex((f) => f.isLatestObs);
  show(latest >= 0 ? latest : frames.length - 1);
}

start();

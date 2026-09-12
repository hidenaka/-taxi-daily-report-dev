// tools/js/radar-app.js — 雨雲レーダー画面の組み立て（DOM / Leaflet 側）
//
// 材料づくりは radar-data.js（純関数・テストあり）。ここは配線だけ。
// 出典表示「出典：気象庁」は利用条件なので必ず地図に出す。
import { weatherUrl, pickHourly, pickDaily, dayLabel, rainStartHint, RAIN_POP } from './radar-weather.js';
import { weatherEmoji, weatherLabel } from '../../js/weather.js';
import { distanceKm } from '../../js/area-geo.js';
import {
  TARGET_TIMES_OBS, TARGET_TIMES_FCST, TARGET_TIMES_SHORT,
  buildFramesWithShortRange, tileUrl, frameLabel, frameClock,
  frameOffsets, nearestFrameIndex, buildTicks,
  searchPlaces, PRESET_PLACES,
} from './radar-data.js';

const VIEW_KEY = 'radarLastView';
const GEO_DENIED_KEY = 'radarGeoDenied';   // 現在地を断られた端末では、毎回きかない      // 最後に見ていた場所（次に開いたとき同じ場所から）
const DEFAULT_VIEW = { lat: 35.5494, lon: 139.7798, zoom: 11 }; // 羽田
const MAX_LAYERS = 12;                 // 端末のメモリを食わないよう、持っておくコマ数の上限
const PLAY_INTERVAL_MS = 450;

const el = (id) => document.getElementById(id);

let map = null;
let frames = [];
let index = 0;
let playTimer = null;
let offsets = { minutes: [], percents: [], totalMin: 0 };
let hereMarker = null;
// 最後に選んだ場所。地図を手で動かして離れたら、名前は出さない
// （「羽田空港の天気」と出ているのに中心は別の街、を防ぐ）。
let placePin = null;   // { name, lat, lon }
const PLACE_NEAR_KM = 3;
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
  saveTimer = setTimeout(() => { saveView(); syncPlaceLabel(); }, 400);
}

function createMap() {
  const v = readView();
  map = L.map('radar-map', { zoomControl: true }).setView([v.lat, v.lon], v.zoom);
  // 背景は国土地理院の淡色地図。Carto の light_all はタイルに
  // 「API KEY REQUIRED」の透かしが入るようになっていた(実機で確認)。
  // 地理院タイルは鍵不要・日本語表記で、出典表示のみが条件。
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18, maxNativeZoom: 18,
    attribution: '地理院タイル ｜ 雨雲：出典 気象庁',
  }).addTo(map);
  // いま動いているアプリの版を、出典表示の横に小さく出す。
  // 「直したはずなのに直っていない」が、更新前の版を見ているだけなのか
  // 判別できるようにするため。
  showRunningVersion();
  // 画面に固定した下のバーのぶん、地図を短くする（バーに隠れないように）。
  // バーの高さは中身で変わるので、実測して伝える。
  const syncBarSpace = () => {
    const bar = el('radar-bar');
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const bottomGap = Math.max(0, (document.documentElement.clientHeight || window.innerHeight) - r.bottom);
    const space = Math.ceil(r.height + bottomGap + 8);
    document.documentElement.style.setProperty('--bar-space', space + 'px');
    if (map) map.invalidateSize({ animate: false });
  };
  syncBarSpace();
  window.addEventListener('resize', syncBarSpace);
  window.addEventListener('orientationchange', syncBarSpace);
  window.addEventListener('load', syncBarSpace);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncBarSpace);
  // コマや目盛りが入ってバーの高さが変わったあとにも合わせ直す
  setTimeout(syncBarSpace, 600);
  setTimeout(syncBarSpace, 2000);

  const c = map.getContainer();
  for (const ev of ['pointerup', 'touchend', 'mouseup', 'wheel']) {
    c.addEventListener(ev, saveViewSoon, { passive: true });
  }
}


// 稼働中のキャッシュ名(= 版)を出典表示の横に足す
async function showRunningVersion() {
  try {
    const keys = await caches.keys().catch(() => []);
    const fromCache = (keys.find((k) => k.startsWith('taxi-daily-')) || '').replace('taxi-daily-', '');
    // キャッシュが無い(=ネットから直接読んでいる)ときは、HTMLに埋めた版を使う
    const meta = document.querySelector('meta[name="app-version"]');
    const v = fromCache || (meta && meta.content) || '';
    if (!v) return;
    const slot = el('radar-ver');
    if (slot) slot.textContent = v;
    const el2 = document.querySelector('.leaflet-control-attribution');
    if (el2 && !el2.textContent.includes(v)) el2.insertAdjacentHTML('beforeend', ` ｜ ${v}`);
  } catch { /* 出せなくても動作に影響なし */ }
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

// バーの下の目盛り。3時間おきに「3時間前 / いま / 3時間後 …」を、
// 時間に比例した位置へ置く。どのあたりの時刻を見ているかが読めるようにするため。
function renderTicks() {
  const box = el('radar-scale');
  if (!box) return;
  const ticks = buildTicks(frames);
  if (ticks.length === 0) { box.innerHTML = ''; return; }

  // 線は1時間おきに全部引く。字は、隣と近すぎるものを伏せる（線だけ残す）。
  // 端末の幅で入る数が変わるので、実際の幅から決める。
  const width = box.getBoundingClientRect().width || 340;
  const MIN_LABEL_PX = 34;
  let lastLabeledPct = -Infinity;
  const html = ticks.map((t, i) => {
    const cls = ['tk'];
    const px = (t.pct / 100) * width;
    const lastPx = (lastLabeledPct / 100) * width;
    // 「いま」と左端は必ず出す。ほかは前のラベルから離れているときだけ。
    const must = t.kind === 'now' || i === 0;
    if (must || px - lastPx >= MIN_LABEL_PX) {
      lastLabeledPct = t.pct;
    } else {
      cls.push('mute');
    }
    if (t.kind === 'now') cls.push('now');
    if (i === 0 && t.pct < 6) cls.push('edge');
    if (i === ticks.length - 1 && t.pct > 94) cls.push('edge', 'r');
    return `<span class="${cls.join(' ')}" style="left:${t.pct.toFixed(2)}%">${t.label}</span>`;
  }).join('');
  box.innerHTML = html;
}

function renderTimeUi() {
  const f = frames[index];
  const nowMs = (frames.find((x) => x.isLatestObs) || {}).timeMs ?? null;
  el('radar-slider').value = String(offsets.minutes[index] ?? 0);
  el('radar-clock').textContent = frameClock(f);
  el('radar-rel').textContent = frameLabel(f, nowMs);
  el('radar-kind').textContent = f.kind !== 'fcst'
    ? '実際に降った雨'
    : (f.product === 'rasrf' ? 'この先の予想（1時間ごと）' : 'この先の予想');
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
  // animate:false で即座に移動する。動かしながらだと、直後に読む中心が
  // まだ移動前のままで、覚える場所が1つ前になってしまう(実機で確認)。
  // 遠くへ飛ぶ操作なので、滑らせるより一気に移るほうが分かりやすい。
  map.setView([lat, lon], zoom, { animate: false });
  saveView(); // 選んだ場所は、その場で覚える(次に開いたときここから)
  placePin = label ? { name: label, lat, lon } : null;
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

// 現在地に赤い点を置く。move=true なら地図もそこへ動かす。
function markHere(lat, lon, move) {
  if (hereMarker) map.removeLayer(hereMarker);
  hereMarker = L.circleMarker([lat, lon], {
    radius: 7, color: '#fff', weight: 2, fillColor: '#e5443a', fillOpacity: 1,
  }).addTo(map);
  if (move) goTo(lat, lon, 13, 'いまの場所');
}

const GEO_OPTS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 };

function useCurrentPosition() {
  const status = el('radar-geo-status');
  if (!navigator.geolocation) { status.textContent = 'この端末では現在地を使えません'; return; }
  status.textContent = '現在地を確認中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      status.textContent = '';
      try { localStorage.removeItem(GEO_DENIED_KEY); } catch { /* 無視 */ }
      markHere(pos.coords.latitude, pos.coords.longitude, true);
    },
    (err) => {
      status.textContent = err && err.code === 1
        ? '現在地の利用が許可されていません'
        : '現在地を取得できませんでした';
      if (err && err.code === 1) {
        try { localStorage.setItem(GEO_DENIED_KEY, '1'); } catch { /* 無視 */ }
      }
    },
    GEO_OPTS,
  );
}

// 開いたときに、そのまま自分の場所が分かるようにする。
// 断られたことがある端末では、毎回きかない（ボタンからはいつでも使える）。
function autoLocateOnStart() {
  if (!navigator.geolocation) return;
  try { if (localStorage.getItem(GEO_DENIED_KEY) === '1') return; } catch { /* 無視 */ }
  navigator.geolocation.getCurrentPosition(
    (pos) => markHere(pos.coords.latitude, pos.coords.longitude, true),
    (err) => {
      if (err && err.code === 1) {
        try { localStorage.setItem(GEO_DENIED_KEY, '1'); } catch { /* 無視 */ }
      }
    },
    GEO_OPTS,
  );
}

// いま地図の中心にある場所の呼び名。選んだ場所から離れていたら名前は使わない。
function currentPlaceName() {
  if (!placePin) return null;
  const c = map.getCenter();
  const km = distanceKm([c.lat, c.lng], [placePin.lat, placePin.lon]);
  return km !== null && km <= PLACE_NEAR_KM ? placePin.name : null;
}

// 地図を動かしたあと、離れていたら場所の名前を消す
function syncPlaceLabel() {
  const label = el('radar-place-label');
  if (!label) return;
  const name = currentPlaceName();
  if (name) { label.textContent = name; label.hidden = false; }
  else { label.hidden = true; }
}

// --- 天気 -----------------------------------------------------------------
// いま地図の真ん中に見えている場所の天気を出す。場所えらびと同じ場所を指すので、
// 「この辺りは何時から降るか」をそのまま見られる。
// 出どころは Open-Meteo（このアプリが日報の天気取得で既に使っている先。鍵不要）。
const WX_TTL_MS = 15 * 60 * 1000;   // 15分は取り直さない
const wxCache = new Map();          // 'lat,lon'(小数2桁) → { at, data }

async function loadWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = wxCache.get(key);
  if (hit && Date.now() - hit.at < WX_TTL_MS) return hit.data;
  const res = await fetch(weatherUrl(lat, lon), { cache: 'no-store' });
  if (!res.ok) throw new Error('weather ' + res.status);
  const data = await res.json();
  wxCache.set(key, { at: Date.now(), data });
  return data;
}

function renderWeather(data, placeName) {
  const now = new Date();
  const hours = pickHourly(data, now, 48);
  const days = pickDaily(data);
  const body = el('radar-wx-body');
  el('radar-wx-title').textContent = placeName ? `${placeName}の天気` : '天気';
  if (hours.length === 0 && days.length === 0) {
    body.innerHTML = '<div class="no-hit">天気を取得できませんでした</div>';
    return;
  }
  const num = (v, unit = '') => (v === null || v === undefined ? '--' : v + unit);
  const cur = hours[0];
  let html = '';

  // まず答えを1行で。表を上から読ませない。
  const hint = rainStartHint(hours);
  if (hint) {
    const cls = hint.includes('降りにくい') ? 'wx-hint' : 'wx-hint rain';
    html += `<div class="${cls}">${hint}</div>`;
  }

  if (cur) {
    html += `<div class="wx-now">
      <span class="emo">${weatherEmoji(cur.code)}</span>
      <span>
        <span class="t">${num(cur.temp, '℃')}</span>
        <div class="sub">${weatherLabel(cur.code)} ・ 雨の降りやすさ ${num(cur.pop, '%')}</div>
      </span>
    </div>`;
  }

  // 時間ごと: 横に流れるグラフ。棒の高さ＝雨の降りやすさ。
  // 3時間おきに時刻と気温を出して、目盛りが混まないようにする。
  html += '<div class="wx-sec">これから48時間</div><div class="wx-chart" id="wx-chart">';
  let lastDate = null;
  hours.forEach((h, i) => {
    if (lastDate !== null && h.date !== lastDate) {
      html += `<div class="wx-daysep">${dayLabel(h.date, now)}</div>`;
    }
    lastDate = h.date;
    const hi = typeof h.pop === 'number' && h.pop >= RAIN_POP;
    const showTick = h.isNow || i % 3 === 0;
    const barH = Math.max(2, Math.round(((h.pop ?? 0) / 100) * 64));
    html += `<div class="wx-col${hi ? ' hi' : ''}${h.isNow ? ' now' : ''}">
      <div class="ch">${h.isNow ? 'いま' : (showTick ? h.hour + '時' : '')}</div>
      <div class="ce">${showTick ? weatherEmoji(h.code) : ''}</div>
      <div class="cbar"><i style="height:${barH}px"></i></div>
      <div class="cpp">${hi || showTick ? num(h.pop, '') : ''}</div>
      <div class="ct">${showTick ? num(h.temp, '°') : ''}</div>
    </div>`;
  });
  html += '</div>';

  // 日ごと: 雨の降りやすさを帯で見せる
  if (days.length) {
    html += '<div class="wx-sec">これから7日</div>';
    for (const d of days) {
      html += `<div class="wx-day">
        <span class="d">${dayLabel(d.date, now)}</span>
        <span class="e">${weatherEmoji(d.code)}</span>
        <span class="tp"><span class="mx">${num(d.max)}</span> / <span class="mn">${num(d.min)}</span>℃</span>
        <span class="dbar"><i style="width:${Math.max(0, Math.min(100, d.pop ?? 0))}%"></i></span>
        <span class="pp">${num(d.pop, '%')}</span>
      </div>`;
    }
  }
  // 予報の升目は約5km四方(実測: 緯度0.05°・経度0.0625°)。近所同士は同じ数字になるので、
  // 「住所を変えたのに数字が同じ」を不具合と思わせないために一言添える。
  html += '<div class="wx-src">棒と帯の高さ＝雨の降りやすさ<br>この予報は約5km四方ごと（近所同士は同じ数字）。雨雲の絵は約250mごと<br>天気の出どころ: Open-Meteo</div>';
  body.innerHTML = html;
}

async function openWeatherPanel() {
  el('radar-weather-panel').classList.add('open');
  const body = el('radar-wx-body');
  body.innerHTML = '<div class="no-hit">読み込み中…</div>';
  const c = map.getCenter();
  const name = currentPlaceName() || 'この場所';
  try {
    renderWeather(await loadWeather(c.lat, c.lng), name);
  } catch {
    body.innerHTML = '<div class="no-hit">天気を取得できませんでした。少し時間をおいて開き直してください。</div>';
  }
}
function closeWeatherPanel() {
  el('radar-weather-panel').classList.remove('open');
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
  const get = (url) => fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  // 短時間予報(1〜15時間先)が取れなくても、ナウキャストだけで動くようにしておく。
  const [obs, fcst, short] = await Promise.all([
    get(TARGET_TIMES_OBS), get(TARGET_TIMES_FCST), get(TARGET_TIMES_SHORT),
  ]);
  return buildFramesWithShortRange(obs, fcst, short);
}

async function start() {
  createMap();
  renderPresets();

  el('radar-play').addEventListener('click', () => setPlaying(!playTimer));
  el('radar-slider').addEventListener('input', (e) => {
    setPlaying(false);
    // つまみの値は「先頭のコマからの経過分」。いちばん近いコマに吸い付かせる。
    show(nearestFrameIndex(frames, Number(e.target.value)));
  });
  el('radar-place-btn').addEventListener('click', openPlacePanel);
  el('radar-weather-btn').addEventListener('click', openWeatherPanel);
  el('radar-weather-close').addEventListener('click', closeWeatherPanel);
  el('radar-place-close').addEventListener('click', closePlacePanel);
  el('radar-here').addEventListener('click', useCurrentPosition);
  let t = null;
  el('radar-search').addEventListener('input', (e) => {
    clearTimeout(t);
    const q = e.target.value;
    t = setTimeout(() => runSearch(q), 150);
  });

  window.addEventListener('resize', () => { if (frames.length) renderTicks(); });
  frames = await loadFrames();
  if (frames.length === 0) {
    el('radar-error').textContent = '雨雲データを取得できませんでした。少し時間をおいて開き直してください。';
    el('radar-error').hidden = false;
    el('radar-bar').hidden = true;
    return;
  }
  offsets = frameOffsets(frames);
  const slider = el('radar-slider');
  slider.min = '0';
  slider.max = String(offsets.totalMin);
  slider.step = '1';
  renderTicks();

  autoLocateOnStart();
  const latest = frames.findIndex((f) => f.isLatestObs);
  show(latest >= 0 ? latest : frames.length - 1);
}

start();

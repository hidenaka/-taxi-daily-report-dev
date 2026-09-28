// tools/js/radar-app.js — 工事/雨雲マップ画面の組み立て（DOM / MapLibre GL 側）
//
// 1枚の地図を、上の切り替えで「雨雲」と「工事」で使い分ける（2026-09-28）。
// 材料づくりは radar-data.js（雨雲）/ koji-data.js（工事）の純関数側。ここは配線だけ。
// 出典表示「出典：気象庁」「東京都建設局・OpenStreetMap」は利用条件なので必ず出す。
import { createKojiUi } from './koji-ui.js';
import { weatherUrl, pickHourly, pickDaily, dayLabel, rainStartHint, RAIN_POP } from './radar-weather.js';
import { weatherEmoji, weatherLabel } from '../../js/weather.js';
import { distanceKm } from '../../js/area-geo.js';
import {
  TARGET_TIMES_OBS, TARGET_TIMES_FCST, TARGET_TIMES_SHORT,
  buildFramesWithShortRange, tileUrl, frameLabel, frameClock,
  frameOffsets, nearestFrameIndex, buildTicks,
  RAIN_LEVELS, maxLevelAround, pointTile, describeRainTimeline,
  MUNI_TABLE_URL, reverseGeocodeUrl, formatCenterAddress,
  searchPlaces, PRESET_PLACES,
} from './radar-data.js';

const VIEW_KEY = 'radarLastView';
const MODE_KEY = 'mapMode';            // 'rain' | 'koji'（次に開いたとき同じ側から）
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
const layers = new Map();  // frameIndex → 雨雲ラスターの layer/source id
let mode = 'rain';         // いま見ているほう
let koji = null;           // 工事の画面（createKojiUi の戻り）
// --- 工事 / 雨雲 の切り替え -------------------------------------------------
const JST_MS = 9 * 3600 * 1000;

// 既定は工事（タブ名「工事/雨雲β」と同じ並び・2026-09-28 本人指示）。
// 前に雨雲を見ていた端末だけ雨雲から開く。
function readMode() {
  try { return localStorage.getItem(MODE_KEY) === 'rain' ? 'rain' : 'koji'; } catch { return 'koji'; }
}

function setMode(next) {
  mode = next === 'koji' ? 'koji' : 'rain';
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* 保存できなくても動く */ }
  document.body.classList.toggle('mode-koji', mode === 'koji');
  el('mode-rain').classList.toggle('active', mode === 'rain');
  el('mode-koji').classList.toggle('active', mode === 'koji');
  el('mode-rain').setAttribute('aria-selected', String(mode === 'rain'));
  el('mode-koji').setAttribute('aria-selected', String(mode === 'koji'));
  el('radar-bar').hidden = mode === 'koji';
  el('koji-ui').hidden = mode !== 'koji';
  if (mode === 'koji') {
    setPlaying(false);
    if (!koji) koji = createKojiUi(map);
    koji.setActive(true);
  } else {
    koji?.setActive(false);
    refreshRainStripSoon();
  }
  show(index);            // 雨雲の濃さを今のモードに合わせる
  syncBarSpaceFn?.();
}

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
  el('radar-locate').addEventListener('click', locateNow);
  el('mode-rain').addEventListener('click', () => setMode('rain'));
  el('mode-koji').addEventListener('click', () => setMode('koji'));
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

  // 前に見ていたほう（雨雲/工事）から始める。工事は雨雲データが無くても動く。
  setMode(readMode());
  autoLocateOnStart();

  frames = await loadFrames();
  if (frames.length === 0) {
    if (mode === 'rain') {
      el('radar-error').textContent = '雨雲データを取得できませんでした。少し時間をおいて開き直してください。';
      el('radar-error').hidden = false;
      el('radar-bar').hidden = true;
    }
    return;
  }
  offsets = frameOffsets(frames);
  const slider = el('radar-slider');
  slider.min = '0';
  slider.max = String(offsets.totalMin);
  slider.step = '1';
  renderTicks();

  if (mode === 'rain') refreshRainStripSoon();
  const latest = frames.findIndex((f) => f.isLatestObs);
  show(latest >= 0 ? latest : frames.length - 1);
}

start();

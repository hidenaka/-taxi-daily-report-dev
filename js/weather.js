const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes → 日本語ラベル
const WMO_LABELS = {
  0: '快晴', 1: '晴', 2: '一部曇', 3: '曇',
  45: '霧', 48: '霧',
  51: '霧雨', 53: '霧雨', 55: '霧雨',
  61: '小雨', 63: '雨', 65: '強雨',
  71: '小雪', 73: '雪', 75: '大雪',
  80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  95: '雷雨', 96: '雷雨', 99: '激しい雷雨'
};

export function weatherLabel(code) {
  return WMO_LABELS[code] || '不明';
}

export function weatherEmoji(code) {
  if (code == null) return '';
  if (code === 0) return '☀️';
  if (code === 1) return '🌤';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 51 && code <= 55) return '🌦';
  if (code >= 61 && code <= 67) return '🌧';
  if (code >= 71 && code <= 77) return '🌨';
  if (code >= 80 && code <= 82) return '🌧';
  if (code >= 95) return '⛈';
  return '';
}

// date と date+1 の2日分を時間別で取得 → 4区分に集計
// 「深夜」が日付をまたぐタクシー乗務に対応するため翌日0-5時も含める
// 天気は無くても保存できるので、返事が来なければ待ち時間の上限で打ち切る。
// 上限が無いと、電波の悪い所で保存ボタンが「天候取得中…」のまま止まる。
export const WEATHER_TIMEOUT_MS = 8000;

export async function fetchWeatherForDate(date, location, { timeoutMs = WEATHER_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const nextDate = addOneDay(date);
  const today = new Date().toISOString().slice(0, 10);
  // 翌日が未来になる場合は forecast を使う(archiveは過去のみ)
  const useArchive = nextDate < today;
  const url = new URL(useArchive ? ARCHIVE_API : FORECAST_API);
  url.searchParams.set('latitude', location.lat);
  url.searchParams.set('longitude', location.lon);
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', nextDate);
  url.searchParams.set('hourly', 'weather_code,temperature_2m,precipitation');
  url.searchParams.set('timezone', 'Asia/Tokyo');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), { signal: ctl.signal });
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    return aggregateByPeriod(data.hourly);
  } finally {
    clearTimeout(timer);
  }
}

function addOneDay(iso) {
  const d = new Date(iso + 'T00:00:00+09:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function mostFrequent(arr) {
  const count = {};
  arr.forEach(v => count[v] = (count[v] || 0) + 1);
  let max = 0, best = arr[0];
  for (const k in count) if (count[k] > max) { max = count[k]; best = parseInt(k); }
  return best;
}

function average(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((s, v) => s + v, 0);
}

// WMO コードの「悪天候度」スコア。降雨/降雪/雷を晴れ/曇りより優先するため使う
function severity(code) {
  if (code >= 95) return 100; // 雷雨
  if (code >= 80 && code <= 82) return 90; // にわか雨
  if (code >= 71 && code <= 77) return 85; // 雪
  if (code === 65) return 70; // 強雨
  if (code === 63) return 60; // 雨
  if (code === 61) return 50; // 小雨
  if (code >= 51 && code <= 55) return 40; // 霧雨
  if (code === 45 || code === 48) return 30; // 霧
  if (code === 3) return 20;  // 曇
  if (code === 2) return 15;  // 一部曇
  if (code === 1) return 10;  // 晴
  if (code === 0) return 5;   // 快晴
  return 0;
}

// その時間帯の代表コードを選ぶ。降雨レベル(severity >= 50)が1時間でもあれば
// その worst を採用、それ以外は mostFrequent。豪雨を曇りに埋もれさせない
function pickRepresentativeCode(codes, precs) {
  if (!codes.length) return null;
  // 1mm/h以上の降水があった時間のコードを優先
  const heavyHourCodes = codes.filter((c, i) => severity(c) >= 50 || (precs[i] != null && precs[i] >= 1));
  if (heavyHourCodes.length > 0) {
    return heavyHourCodes.reduce((best, c) => severity(c) > severity(best) ? c : best, heavyHourCodes[0]);
  }
  return mostFrequent(codes);
}

function aggregateByPeriod(hourly) {
  // 各 period が参照する hourly 配列のインデックス
  // (date 0時=index 0, ..., date+1 0時=index 24, date+1 5時=index 29)
  // 深夜は実際の乗務跨ぎ時間帯(date 23時 + date+1 0-5時)
  const periods = {
    morning: [6, 7, 8, 9, 10, 11],
    noon: [12, 13, 14, 15, 16, 17],
    evening: [18, 19, 20, 21, 22],
    night: [23, 24, 25, 26, 27, 28] // = date 23時 〜 date+1 4時
  };
  const result = {};
  for (const [name, hours] of Object.entries(periods)) {
    const codes = [], temps = [], precs = [];
    for (const h of hours) {
      if (hourly.weather_code?.[h] != null) codes.push(hourly.weather_code[h]);
      if (hourly.temperature_2m?.[h] != null) temps.push(hourly.temperature_2m[h]);
      if (hourly.precipitation?.[h] != null) precs.push(hourly.precipitation[h]);
    }
    const code = pickRepresentativeCode(codes, precs);
    result[name] = {
      code,
      label: weatherLabel(code),
      tempAvg: temps.length > 0 ? Math.round(average(temps) * 10) / 10 : null,
      precipMm: precs.length > 0 ? Math.round(sum(precs) * 10) / 10 : 0
    };
  }
  return result;
}

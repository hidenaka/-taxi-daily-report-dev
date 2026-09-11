// 雨雲ページの「天気」パネルの材料づくり（DOM非依存の純関数のみ）
//
// データ元は Open-Meteo。鍵不要・出典表示も不要（このアプリが日報の天気取得で
// 既に使っている先と同じ）。日本時間で返してもらうので、時刻はそのまま扱える。
// 天気の絵文字・言葉は js/weather.js（既存）をそのまま使う。

const API = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = 'temperature_2m,precipitation_probability,weathercode';
const DAILY = 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max';
export const FORECAST_DAYS = 7;

export function weatherUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: HOURLY,
    daily: DAILY,
    timezone: 'Asia/Tokyo',
    forecast_days: String(FORECAST_DAYS),
  });
  return `${API}?${q.toString()}`;
}

const round = (v) => (typeof v === 'number' ? Math.round(v) : null);

// 'YYYY-MM-DDTHH:00' の並びから「いま進行中の時間帯」以降を切り出す。
// forecast_hours で切ってもらうと開始位置が期待とずれたので、こちらで切る。
export function pickHourly(json, now = new Date(), limit = 48) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const pad = (n) => String(n).padStart(2, '0');
  const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
  let start = h.time.indexOf(key);
  if (start < 0) start = h.time.findIndex((t) => t >= key); // 欠けていたら直後から
  if (start < 0) return [];
  const out = [];
  for (let i = start; i < h.time.length && out.length < limit; i++) {
    const t = h.time[i];
    out.push({
      time: t,
      date: t.slice(0, 10),
      hour: Number(t.slice(11, 13)),
      temp: round(h.temperature_2m?.[i]),
      pop: round(h.precipitation_probability?.[i]),
      code: h.weathercode?.[i] ?? null,
      isNow: i === start,
    });
  }
  return out;
}

export function pickDaily(json) {
  const d = json && json.daily;
  if (!d || !Array.isArray(d.time)) return [];
  return d.time.map((date, i) => ({
    date,
    code: d.weathercode?.[i] ?? null,
    max: round(d.temperature_2m_max?.[i]),
    min: round(d.temperature_2m_min?.[i]),
    pop: round(d.precipitation_probability_max?.[i]),
  }));
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// 日付の見出し。今日・明日はその言葉で出す（そのほうが早く読める）。
export function dayLabel(date, now = null) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  if (now) {
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (date === today) return '今日';
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    if (date === tomorrow) return '明日';
  }
  const dow = DOW[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${dow})`;
}

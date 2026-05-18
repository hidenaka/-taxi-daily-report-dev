import {
  renderEnsemble, renderThroughputBanner,
  renderForecastMeta, renderForecastTable,
  renderPatternMeta, renderSimilarDays, renderHistoricalCurve,
} from './forecast-render.js';

const SOURCES = [
  { key: 'ensemble', path: 'data/stall-ensemble.json' },
  { key: 'forecast', path: 'data/stall-forecast.json' },
  { key: 'patternMatch', path: 'data/stall-pattern-match.json' },
];

// 予測 JSON 3種を取得する。各取得は独立。失敗は errors に記録し例外を投げない。
export async function loadForecastData(fetchFn = fetch) {
  const result = { ensemble: null, forecast: null, patternMatch: null, errors: {} };
  for (const { key, path } of SOURCES) {
    try {
      const res = await fetchFn(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result[key] = await res.json();
    } catch (e) {
      result.errors[key] = e.message;
    }
  }
  return result;
}

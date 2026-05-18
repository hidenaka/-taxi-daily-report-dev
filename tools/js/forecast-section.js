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

// arrivals.html 内の予測セクションを描画する。
// 各データは独立して描画/エラー表示する（1つの失敗が他をブロックしない）。
export async function initForecastSection() {
  const data = await loadForecastData();

  const ensembleMetaEl = document.getElementById('ensemble-meta');
  const ensembleTableEl = document.getElementById('ensemble-table-wrap');
  const bannerEl = document.getElementById('throughput-banner');
  if (data.ensemble) {
    renderEnsemble(ensembleMetaEl, ensembleTableEl, data.ensemble);
    renderThroughputBanner(bannerEl, data.ensemble);
  } else {
    ensembleMetaEl.textContent = `統合予測データの読み込みに失敗: ${data.errors.ensemble}`;
    ensembleTableEl.innerHTML = '';
  }

  const metaEl = document.getElementById('forecast-meta');
  const tableEl = document.getElementById('forecast-table-wrap');
  if (data.forecast) {
    renderForecastMeta(metaEl, data.forecast);
    renderForecastTable(tableEl, data.forecast);
  } else {
    metaEl.textContent = `予測データの読み込みに失敗: ${data.errors.forecast}`;
    tableEl.innerHTML = '';
  }

  const patternMetaEl = document.getElementById('pattern-meta');
  const similarDaysEl = document.getElementById('similar-days');
  const curveEl = document.getElementById('historical-curve-wrap');
  if (data.patternMatch) {
    renderPatternMeta(patternMetaEl, data.patternMatch);
    renderSimilarDays(similarDaysEl, data.patternMatch);
    renderHistoricalCurve(curveEl, data.patternMatch);
  } else {
    patternMetaEl.textContent = `類似日マッチングデータの読み込みに失敗: ${data.errors.patternMatch}`;
    similarDaysEl.innerHTML = '';
    curveEl.innerHTML = '';
  }
}

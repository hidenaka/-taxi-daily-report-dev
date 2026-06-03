// タクシー出庫予測セクション。
// taxi-ic-helper が出力する統合予測 (stall-ensemble.json) を読み込み、
// 5分スロットを15分単位に合算して到着便ページに1つの表として描画する。

const STALL_KEYS = ['stall1', 'stall2', 'stall3', 'stall4'];

// 予測データが古い(=供給が止まっている)とみなす閾値。
// 配信は定期同期(最大で数十分のラグ)なので、通常運用のラグでは誤検知しない 120 分に設定。
// これより古ければ Mac mini 観測の停止や配信不通の可能性が高い。
const STALE_MINUTES = 120;

// "HH:MM" → 分
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// 営業日 (JST 8:00〜翌7:59) の出庫スロット total を合計する純関数。
// 国内線の偶数日/奇数日待機ルール切替が JST 8:00 なので、それで集計境界を切る。
// stall-actuals.json の slot.slotStart は HH:MM のみで日付情報が無いため、
// stall-actuals.json 上流 (computeSlotActuals) で windowMinutes を 直近の 8:00 起点
// に動的化することで、 入っている slot 全部が「現営業日」 のものになる前提。
// 関数側は 念のため "08:00 以降" のフィルタで二重防御 (HH:MM が当日のものなら 8 以上)。
export function computeAccumulatedTotal(slots, now) {
  if (!Array.isArray(slots) || slots.length === 0) return 0;
  return slots.reduce((sum, s) => sum + (s.total || 0), 0);
}

// 分 → "H:MM"
function toHHMM(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// generatedAt が now から maxMinutes より古ければ true。
// 未設定・解釈不能な値も「古い(取得できていない)」とみなす。
export function isStale(generatedAt, now, maxMinutes) {
  if (!generatedAt) return true;
  const gen = new Date(generatedAt).getTime();
  if (Number.isNaN(gen)) return true;
  return (now.getTime() - gen) > maxMinutes * 60 * 1000;
}

// 5分スロット配列を15分ビンに合算する。
// 入力 slots は時系列順の配列（予測の発生順）。出力ビンもその順序を保つ
// ＝ Map の挿入順をそのまま使う。時分だけでソートすると日跨ぎ（23時台→0時台）で
// 0:00 が先頭に来てしまうため、ソートしない。
// 出力ビン: { label: "H:MM-H:MM", stall1..stall4, total }（total は乗り場合計で再計算）
export function aggregateTo15min(slots) {
  const bins = new Map();
  for (const s of slots || []) {
    const binStart = Math.floor(toMinutes(s.slotStart) / 15) * 15;
    if (!bins.has(binStart)) {
      bins.set(binStart, { binStart, stall1: 0, stall2: 0, stall3: 0, stall4: 0 });
    }
    const b = bins.get(binStart);
    for (const k of STALL_KEYS) b[k] += s[k] || 0;
  }
  return [...bins.values()]
    .map(b => ({
      label: `${toHHMM(b.binStart)}-${toHHMM(b.binStart + 15)}`,
      stall1: b.stall1,
      stall2: b.stall2,
      stall3: b.stall3,
      stall4: b.stall4,
      total: b.stall1 + b.stall2 + b.stall3 + b.stall4,
    }));
}

// 統合予測 JSON を取得する。失敗は例外を投げず { data, error } で返す。
export async function loadEnsemble(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/stall-ensemble.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// 出庫実績 JSON を取得する。失敗は例外を投げず { data, error } で返す。
export async function loadActuals(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/stall-actuals.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// 列移動回数(実測+予測) JSON を取得する。失敗は { data:null, error } で返す。
export async function loadAdvanceForecast(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/advance-forecast.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

const STALL_LABELS = { stall1: '第1', stall2: '第2', stall3: '第3', stall4: '第4' };

// 乗り場ごとの「列移動回数（直近15分・実測/予測）」ブロックを HTML 文字列で返す。
export function renderMovement(adv) {
  const cur = adv && adv.current;
  if (!cur || !cur.stalls) return '';
  const rows = Object.keys(STALL_LABELS).map((s) => {
    const v = cur.stalls[s] || {};
    const actual = (typeof v.actual === 'number') ? `${v.actual}回` : '—';
    const fc = (typeof v.forecast === 'number') ? v.forecast : '—';
    return `<div class="sm-row"><span class="sm-stall">${STALL_LABELS[s]}乗り場</span>`
      + `<span class="sm-actual">${actual}</span>`
      + `<span class="sm-fc">予測 ${fc}</span></div>`;
  }).join('');
  return `<div class="sm-title">乗り場の動き（列移動回数・直近15分）</div>`
    + `<div class="sm-rows">${rows}</div>`
    + `<div class="sm-note">※計測の都合で実際より少なめに出ます</div>`;
}

// 15分ビン配列を HTML テーブルに描画する。
function renderTable(bins) {
  if (bins.length === 0) return '<p class="fc-empty">予測データなし</p>';
  const rows = bins.map(b => `<tr>
      <td class="fc-time">${b.label}</td>
      <td>${b.stall1}</td><td>${b.stall2}</td><td>${b.stall3}</td><td>${b.stall4}</td>
      <td class="fc-total">${b.total}</td>
    </tr>`).join('');
  return `<table class="fc-table">
    <thead><tr><th>時間帯</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 出庫実績スロット配列を HTML テーブルに描画する（乗り場別＋合計）。
export function renderActualsTable(slots) {
  if (!slots || slots.length === 0) return '<p class="fc-empty">実績データなし</p>';
  const rows = slots.map(s => `<tr>
      <td class="fc-time">${s.slotStart}-${s.slotEnd}</td>
      <td>${s.stall1 ?? 0}</td><td>${s.stall2 ?? 0}</td><td>${s.stall3 ?? 0}</td><td>${s.stall4 ?? 0}</td>
      <td class="fc-total">${s.total ?? 0}</td>
    </tr>`).join('');
  return `<table class="fc-table">
    <thead><tr><th>時間帯</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 予測モードの localStorage キー。
const MODE_STORAGE_KEY = 'arrivalsForecastMode';
// 「今日全部表示」toggle の localStorage キー。
const DETAIL_STORAGE_KEY = 'arrivalsForecastDetail';

// 直近2時間 (15分bin で 8 件) に絞る純関数。 detail=true なら入力をそのまま返す。
// データが少ない場合は 全件返す。
export function limitSlotsToRecent(slots, detail, recentBins = 8) {
  if (!Array.isArray(slots)) return [];
  if (detail) return slots;
  if (slots.length <= recentBins) return slots;
  return slots.slice(-recentBins);
}

// 15分 slot を 1時間 単位に集計する純関数。 sparkline 表示用。
// 出力は { hour: 0-23, stall1-4, total } の配列、 hour 昇順。
export function aggregateBy1Hour(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const byHour = new Map();
  for (const s of slots) {
    const hh = String(s.slotStart || '').slice(0, 2);
    const h = parseInt(hh, 10);
    if (Number.isNaN(h)) continue;
    if (!byHour.has(h)) {
      byHour.set(h, { hour: h, stall1: 0, stall2: 0, stall3: 0, stall4: 0, total: 0 });
    }
    const b = byHour.get(h);
    b.stall1 += s.stall1 ?? 0;
    b.stall2 += s.stall2 ?? 0;
    b.stall3 += s.stall3 ?? 0;
    b.stall4 += s.stall4 ?? 0;
    b.total += s.total ?? 0;
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

// 1時間 sparkline HTML を生成。 棒の長さは max 比で正規化。
function renderHourlySparkline(hourlyData) {
  if (!hourlyData || hourlyData.length === 0) return '';
  const max = Math.max(1, ...hourlyData.map(h => h.total));
  const rows = hourlyData.map(h => {
    const pct = Math.round((h.total / max) * 100);
    return `<div class="fc-spark-row">
      <span class="fc-spark-hour">${h.hour}時</span>
      <span class="fc-spark-bar"><span class="fc-spark-bar-fill" style="width:${pct}%"></span></span>
      <span class="fc-spark-total">${h.total}回</span>
    </div>`;
  }).join('');
  return `<div class="fc-sparkline">
    <div class="fc-spark-label">1時間ごとの列移動回数</div>
    ${rows}
  </div>`;
}

// advance-forecast.json の slots/actualsToday ([{time, stalls}]) を表テーブル用 bin 形に変換。
function advSlotsToBins(slots) {
  return (slots || []).map((s) => {
    const [h, m] = String(s.time).split(':').map(Number);
    const endM = (h * 60 + m + 15);
    const eh = String(Math.floor(endM / 60) % 24).padStart(2, '0');
    const em = String(endM % 60).padStart(2, '0');
    const st = s.stalls || {};
    const v = (k) => Number(st[k] ?? 0);
    const r = { label: `${s.time}-${eh}:${em}`, stall1: v('stall1'), stall2: v('stall2'), stall3: v('stall3'), stall4: v('stall4') };
    r.total = Number((r.stall1 + r.stall2 + r.stall3 + r.stall4).toFixed(1));
    return r;
  });
}

// bin 配列 → 1時間ごとの {hour,total} (sparkline用)。
function advHourly(bins) {
  const m = new Map();
  for (const b of bins) {
    const h = parseInt(String(b.label).slice(0, 2), 10);
    if (Number.isNaN(h)) continue;
    m.set(h, (m.get(h) || 0) + b.total);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([hour, total]) => ({ hour, total: Number(total.toFixed(1)) }));
}

// 実績モード（列移動回数・今日の実測）を描画する。
async function renderActualsMode(metaEl, tableEl, detail) {
  const { data, error } = await loadAdvanceForecast();
  if (error || !data) {
    metaEl.textContent = '列移動データを取得できていません。しばらくしてから更新してください。';
    tableEl.innerHTML = '';
    return;
  }
  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  const bins = advSlotsToBins(data.actualsToday);
  if (bins.length === 0) {
    metaEl.textContent = '本日の列移動 実測データはまだありません。';
    tableEl.innerHTML = '<p class="fc-empty">実測データなし</p>';
    return;
  }
  const accum = Number(bins.reduce((s, b) => s + b.total, 0).toFixed(0));
  const scopeLabel = detail ? '今日全部' : '直近2時間';
  metaEl.textContent = `実測（列移動回数）${ts ? ts + ' 時点' : ''}  /  本日累計 ${accum}回  /  ${scopeLabel}表示  ※計測の都合で少なめ`;
  tableEl.innerHTML = renderTable(limitSlotsToRecent(bins, detail));
  const sparkEl = document.getElementById('forecast-sparkline');
  if (sparkEl) sparkEl.innerHTML = renderHourlySparkline(advHourly(bins));
}

// 予測モード（列移動回数・モデル予測）を描画する。
async function renderForecastMode(metaEl, tableEl, detail) {
  const { data, error } = await loadAdvanceForecast();
  if (error || !data) {
    metaEl.textContent = '列移動の予測データを取得できていません。しばらくしてから更新してください。';
    tableEl.innerHTML = '';
    return;
  }
  const bins = advSlotsToBins(data.slots);
  if (bins.length === 0) {
    metaEl.textContent = '列移動の予測データがまだありません。';
    tableEl.innerHTML = '<p class="fc-empty">予測データなし</p>';
    return;
  }
  const scopeLabel = detail ? '今日全部' : '今後2時間';
  metaEl.textContent = `予測（列移動回数・時間帯の目安）  /  ${scopeLabel}表示  ※計測の都合で少なめ`;
  // 予測カーブは時間帯の目安。現在時刻以降に絞って表示。
  const nowHM = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16);
  const upcoming = bins.filter((b) => b.label.slice(0, 5) >= nowHM);
  const shown = (upcoming.length ? upcoming : bins);
  tableEl.innerHTML = renderTable(detail ? shown : shown.slice(0, 8));
  const sparkEl = document.getElementById('forecast-sparkline');
  if (sparkEl) sparkEl.innerHTML = renderHourlySparkline(advHourly(bins));
}

// 到着便ページの予測セクションを初期化・描画する。
// プルダウンで実績（既定）／予測を切り替える。選択は localStorage に保存。
// 戻り値: 再描画関数（更新ボタンから最新データを取り直すのに使う）。
// 必要な要素が無いときは undefined。
export async function initForecastSection() {
  const metaEl = document.getElementById('forecast-meta');
  const tableEl = document.getElementById('forecast-table-wrap');
  const modeEl = document.getElementById('forecast-mode');
  if (!metaEl || !tableEl || !modeEl) return;

  let saved = null;
  try { saved = localStorage.getItem(MODE_STORAGE_KEY); } catch { /* ignore */ }
  modeEl.value = (saved === 'forecast') ? 'forecast' : 'actuals';

  // detail (今日全部表示) state — localStorage に保存
  let detail = false;
  try { detail = localStorage.getItem(DETAIL_STORAGE_KEY) === '1'; } catch { /* ignore */ }
  const scopeRecentBtn = document.getElementById('forecast-scope-recent');
  const scopeAllBtn = document.getElementById('forecast-scope-all');
  function updateScopeBtns() {
    if (scopeRecentBtn) scopeRecentBtn.classList.toggle('is-active', !detail);
    if (scopeAllBtn) scopeAllBtn.classList.toggle('is-active', detail);
  }
  updateScopeBtns();

  async function render() {
    metaEl.textContent = '読み込み中...';
    tableEl.innerHTML = '';
    if (modeEl.value === 'forecast') {
      await renderForecastMode(metaEl, tableEl, detail);
    } else {
      await renderActualsMode(metaEl, tableEl, detail);
    }
  }

  modeEl.addEventListener('change', () => {
    try { localStorage.setItem(MODE_STORAGE_KEY, modeEl.value); } catch { /* ignore */ }
    render().catch(err => {
      metaEl.textContent = 'データを読み込めませんでした';
      console.error(err);
    });
  });

  function setDetail(next) {
    if (detail === next) return;
    detail = next;
    try { localStorage.setItem(DETAIL_STORAGE_KEY, detail ? '1' : '0'); } catch { /* ignore */ }
    updateScopeBtns();
    render().catch(err => {
      metaEl.textContent = 'データを読み込めませんでした';
      console.error(err);
    });
  }
  if (scopeRecentBtn) scopeRecentBtn.addEventListener('click', () => setDetail(false));
  if (scopeAllBtn) scopeAllBtn.addEventListener('click', () => setDetail(true));

  // 列移動回数(直近15分・実測/予測)を併記。モード非依存で1回描画。
  const movEl = document.getElementById('stall-movement-block');
  if (movEl) {
    loadAdvanceForecast().then(({ data }) => {
      const html = data ? renderMovement(data) : '';
      movEl.innerHTML = html;
      movEl.style.display = html ? '' : 'none';
    }).catch(() => { movEl.style.display = 'none'; });
  }

  await render();
  return render;
}

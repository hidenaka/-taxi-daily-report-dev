// タクシー出庫予測セクション。
// taxi-ic-helper が出力する統合予測 (stall-ensemble.json) を読み込み、
// 5分スロットを15分単位に合算して到着便ページに1つの表として描画する。

const STALL_KEYS = ['stall1', 'stall2', 'stall3', 'stall4'];

// 予測データが古い(=供給が止まっている)とみなす閾値。供給元は数分ごとに更新されるため、
// これより古ければ Mac mini 観測の停止や配信不通の可能性が高い。
const STALE_MINUTES = 60;

// "HH:MM" → 分
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
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
    .sort((a, b) => a.binStart - b.binStart)
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

// 15分ビン配列を HTML テーブルに描画する。
function renderTable(bins) {
  if (bins.length === 0) return '<p class="fc-empty">予測データなし</p>';
  const rows = bins.map(b => `<tr>
      <td class="fc-time">${b.label}</td>
      <td>${b.stall1}</td><td>${b.stall2}</td><td>${b.stall3}</td><td>${b.stall4}</td>
      <td class="fc-total">${b.total}</td>
    </tr>`).join('');
  return `<table class="fc-table">
    <thead><tr><th>時間帯</th><th>乗1</th><th>乗2</th><th>乗3</th><th>乗4</th><th>計</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 到着便ページの予測セクションを初期化・描画する。
export async function initForecastSection() {
  const metaEl = document.getElementById('forecast-meta');
  const tableEl = document.getElementById('forecast-table-wrap');
  if (!metaEl || !tableEl) return;

  const { data, error } = await loadEnsemble();
  if (error) {
    metaEl.textContent = `予測データを取得できていません（${error}）`;
    tableEl.innerHTML = '';
    return;
  }

  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  // 古いデータは表を出さない。停止中の予測を最新のように見せない。
  if (isStale(data.generatedAt, new Date(), STALE_MINUTES)) {
    metaEl.textContent = ts
      ? `予測データを取得できていません（最終 ${ts}）`
      : '予測データを取得できていません';
    tableEl.innerHTML = '';
    return;
  }

  metaEl.textContent = ts ? `予測時刻 ${ts} 時点` : '';
  tableEl.innerHTML = renderTable(aggregateTo15min(data.slots));
}

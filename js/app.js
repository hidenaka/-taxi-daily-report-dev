// 開発環境判定 (GitHub Actions test)
export function isDevEnvironment() {
  return location.hostname.includes('-dev') || 
         location.pathname.includes('/dev/');
}

export function renderBottomNav(activePage) {
  const items = [
    { id: 'home', label: 'ホーム', href: 'index.html' },
    { id: 'input', label: '入力', href: 'input.html' },
    { id: 'calendar', label: 'カレンダー', href: 'calendar.html' },
    { id: 'analytics', label: '分析', href: 'support.html' },
    { id: 'tools', label: 'ツール', href: 'tools.html' },
    { id: 'settings', label: '設定', href: 'settings.html' }
  ];
  const isActive = (it) => {
    if (it.id === 'analytics') return activePage === 'analytics' || activePage === 'review' || activePage === 'support';
    return it.id === activePage;
  };
  return `
    <nav class="bottom">
      ${items.map(it => `<a href="${it.href}" class="${isActive(it) ? 'active' : ''}">${it.label}</a>`).join('')}
    </nav>`;
}

export function formatYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

export function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00+09:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

// 年付き: "2026/4/19(日)"
export function formatDateY(isoDate) {
  const d = new Date(isoDate + 'T00:00:00+09:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

// ローカル(JST)タイムゾーンでの YYYY-MM-DD 文字列を返す
export function toLocalIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso() {
  return toLocalIso(new Date());
}

// タクシー業界の月度（16日始まり〜翌月15日締め、2月のみ16-13、3月度は2/14スタート）
// 任意の日付 (YYYY-MM-DD) → 月度ラベル (YYYY-MM)
export function getBillingPeriod(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Feb の場合: day <= 13 → 2月度 (this year, month 2). day >= 14 → 3月度 (this year, month 3).
  if (m === 2) {
    if (d <= 13) return `${y}-02`;
    return `${y}-03`;
  }
  // 通常: day >= 16 → 翌月度. day <= 15 → 当月度.
  if (d >= 16) {
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    return `${nextYear}-${String(nextMonth).padStart(2,'0')}`;
  }
  return `${y}-${String(m).padStart(2,'0')}`;
}

// 月度ラベル (YYYY-MM) → 期間レンジ {start, end}
export function getBillingPeriodRange(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const endDay = m === 2 ? 13 : 15;
  let startMonth = m - 1;
  let startYear = y;
  if (startMonth === 0) { startMonth = 12; startYear--; }
  let startDay = 16;
  // 3月度: 2月度の終わり翌日 (2/14) 開始
  if (m === 3) { startMonth = 2; startDay = 14; }
  return {
    start: `${startYear}-${String(startMonth).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
    end: `${y}-${String(m).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`
  };
}

export function currentBillingPeriod() {
  return getBillingPeriod(todayIso());
}

// 月度ラベルを表示用フォーマット ("2026-04" → "2026年4月度")
export function formatBillingPeriod(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${y}年${m}月度`;
}

// 月度ラベルから前/次の月度を返す
export function shiftBillingPeriod(yearMonth, delta) {
  const [y, m] = yearMonth.split('-').map(Number);
  let nm = m + delta;
  let ny = y;
  while (nm <= 0) { nm += 12; ny--; }
  while (nm > 12) { nm -= 12; ny++; }
  return `${ny}-${String(nm).padStart(2,'0')}`;
}

// 後方互換 (旧コード対応): currentYearMonth は currentBillingPeriod に置換
export function currentYearMonth() {
  return currentBillingPeriod();
}

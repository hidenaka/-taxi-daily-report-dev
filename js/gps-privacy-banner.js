// GPS プライバシー説明バナー（共通モジュール）
//
// 役割: GPS を使うページの最上部に「現在地はボタン押下時のみ取得、保存も共有もしません」
// 説明を出す。Chrome の位置情報許可ダイアログが出る前に意識してもらうための事前案内。
// 閉じれる（×ボタン）。一度閉じたら localStorage に記憶し、全GPSページで再表示しない。
//
// 使い方: GPS を使うページから以下を呼ぶだけ。
//   import { showGpsPrivacyBanner } from './js/gps-privacy-banner.js';
//   showGpsPrivacyBanner();
// （tools/*.html のように `js/` が1階層上なら `'../js/gps-privacy-banner.js'`）

const DISMISSED_KEY = 'cabis_gps_privacy_dismissed';
const BANNER_ID = 'gpsPrivacyBanner';

export function showGpsPrivacyBanner() {
  if (typeof document === 'undefined') return;
  // 既にDOM上にあれば何もしない（複数呼び出し防止）
  if (document.getElementById(BANNER_ID)) return;
  // 本人が一度閉じていたら表示しない
  try {
    if (localStorage.getItem(DISMISSED_KEY) === '1') return;
  } catch (_) { /* localStorage 無効環境では無視して表示 */ }

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'note');
  banner.setAttribute('aria-label', 'GPSの使い方について');
  banner.style.cssText = [
    'position:sticky',
    'top:0',
    'left:0',
    'right:0',
    'z-index:9998',
    'background:#f0f9ff',
    'border-bottom:1px solid #7dd3fc',
    'color:#075985',
    'padding:8px 36px 8px 14px',
    'font-size:12px',
    'line-height:1.5',
    'font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif',
  ].join(';');

  banner.innerHTML =
    '<strong>🛡️ 「📍 現在地から自動入力」は、ボタンを押した時だけ動きます。</strong> '
    + '<span style="font-size:11px;">取得した場所は入力欄を埋めるためだけに使い、保存・共有はしません。'
    + 'ボタンを押さなければ、場所は受け取りません。</span>'
    + '<button type="button" aria-label="この説明を閉じる" '
    + 'style="position:absolute;right:6px;top:4px;background:transparent;border:none;'
    + 'color:#075985;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;">×</button>';

  banner.querySelector('button').addEventListener('click', () => {
    banner.remove();
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch (_) { /* ignore */ }
  });

  // body 直下の最上部に挿入。sticky position により上にとどまる。
  if (document.body.firstChild) {
    document.body.insertBefore(banner, document.body.firstChild);
  } else {
    document.body.appendChild(banner);
  }
}

// 開発・テスト用: localStorage クリアして再表示できるようにする
export function resetGpsPrivacyBannerDismissal() {
  try { localStorage.removeItem(DISMISSED_KEY); } catch (_) { /* ignore */ }
}

// js/legal-footer.js — 法務文書フッターの共通描画モジュール

export function renderLegalFooter() {
  // 法務ページ内では別表示なのでスキップ
  if (location.pathname.includes('/legal/')) return;

  // 既に存在する場合は何もしない（idempotent）
  if (document.querySelector('.legal-footer')) return;

  const footer = document.createElement('footer');
  footer.className = 'legal-footer';
  footer.innerHTML = `
    <div class="legal-footer-links">
      <a href="legal/tokuteishou.html">特定商取引法に基づく表記</a>
      <span class="legal-footer-sep">|</span>
      <a href="legal/terms.html">利用規約</a>
      <span class="legal-footer-sep">|</span>
      <a href="legal/privacy.html">プライバシーポリシー</a>
    </div>
    <div class="legal-footer-copyright">© 2026 Cabis</div>
  `;

  // bottom-nav の真上に挿入。bottom-nav が無いページは末尾に追加
  const nav = document.querySelector('nav.bottom');
  if (nav) {
    nav.parentNode.insertBefore(footer, nav);
  } else {
    document.body.appendChild(footer);
  }
}

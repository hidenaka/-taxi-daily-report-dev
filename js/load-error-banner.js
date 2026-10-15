// 日報を読み込めなかったときに、画面の上に出すお知らせ。
// 0件として描くと月の全日が「公休」に見えてしまうので、描かずにこれを出す(2026-10-16)。
export function showLoadError(err) {
  console.warn('load failed:', err);
  const main = document.querySelector('main');
  if (!main || document.getElementById('loadErrorBanner')) return;
  const box = document.createElement('div');
  box.id = 'loadErrorBanner';
  box.className = 'card';
  box.style.cssText = 'background:#fff4e5;border:1px solid #f0b46a;color:#7a4b00;';
  box.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">日報を読み込めませんでした</div>'
    + '<div style="font-size:13px;margin-bottom:8px;">通信が切れていた可能性があります。通信を確かめて、開き直してください。</div>'
    + '<button type="button" class="btn">開き直す</button>';
  box.querySelector('button').onclick = () => location.reload();
  main.prepend(box);
}

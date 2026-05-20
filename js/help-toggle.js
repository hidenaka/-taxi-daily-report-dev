// ?ヘルプボタンの開閉。タップで対応する .help-content をトグル、再タップで閉じる。
// event delegation で実装、後から差し替わる DOM でも動作する。
// 使い方:
//   <button class="help-btn" data-help-for="KEY">?</button>
//   <div class="help-content" id="help-KEY">...</div>
// import するだけで開閉が有効になる。
function onClick(e) {
  const btn = e.target.closest('.help-btn');
  if (!btn) return;
  const key = btn.getAttribute('data-help-for');
  if (!key) return;
  const content = document.getElementById('help-' + key);
  if (!content) return;
  const willOpen = !btn.classList.contains('open');
  content.classList.toggle('open', willOpen);
  btn.classList.toggle('open', willOpen);
  if (willOpen) content.removeAttribute('hidden');
  else content.setAttribute('hidden', '');
}
document.addEventListener('click', onClick);

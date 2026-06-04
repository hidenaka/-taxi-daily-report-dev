// アプリ更新の自動検知 + 上部帯。SW 登録は各ページの既存コードが行う。
// 新しいバージョン(SW)が見つかると「新しいバージョンがあります [今すぐ更新]」帯を出し、
// タップでキャッシュ全消去→再読み込みして最新ページへ更新する(閉じ開きの2回ダンス不要)。
// 起動時・1時間ごと・アプリが前面に戻った時(visibilitychange)に更新チェックする。
(() => {
  if (!('serviceWorker' in navigator)) return;
  let shown = false;

  function showBanner() {
    if (shown || document.getElementById('app-update-banner')) return;
    shown = true;
    const bar = document.createElement('div');
    bar.id = 'app-update-banner';
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1c8c5a;color:#fff;' +
      'padding:10px 14px;display:flex;align-items:center;justify-content:center;gap:12px;' +
      'font:600 14px/1.4 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.25)';
    const msg = document.createElement('span');
    msg.textContent = '🔄 新しいバージョンがあります';
    const btn = document.createElement('button');
    btn.textContent = '今すぐ更新';
    btn.style.cssText =
      'background:#fff;color:#1c8c5a;border:0;border-radius:6px;padding:6px 16px;' +
      'font:700 14px -apple-system,sans-serif;cursor:pointer;flex:none';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '更新中…';
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) { /* キャッシュ消去に失敗してもリロードは行う */ }
      location.reload();
    });
    bar.append(msg, btn);
    (document.body || document.documentElement).appendChild(bar);
  }

  function watch(reg) {
    if (!reg) return;
    // 再訪時に既に新SWが待機している場合
    if (reg.waiting && navigator.serviceWorker.controller) showBanner();
    // 新SWが見つかってインストール完了(既存の制御SWあり=更新)したら帯を出す
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showBanner();
      });
    });
    const check = () => { reg.update().catch(() => {}); };
    check();                                   // 起動時
    setInterval(check, 60 * 60 * 1000);        // 1時間ごと
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();           // アプリが前面に戻った時(再起動相当)
    });
  }

  navigator.serviceWorker
    .getRegistration()
    .then((reg) => (reg ? watch(reg) : navigator.serviceWorker.ready.then(watch)))
    .catch(() => {});
})();

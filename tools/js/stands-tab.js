// tools/js/stands-tab.js — 乗り場タブを「会社が standsMapEnabled の時だけ」表示する。
// 各ツールページの app-tabs に <a id="tab-stands" style="display:none"> を置き、これを読み込む。
import { loadCompanyProfile } from '../../js/firebase-storage.js';

(async () => {
  try {
    const c = await loadCompanyProfile();
    if (c && c.standsMapEnabled === true) {
      const el = document.getElementById('tab-stands');
      if (el) el.style.display = '';
    }
  } catch (e) { /* 未ログイン・非対象会社は出さないまま */ }
})();

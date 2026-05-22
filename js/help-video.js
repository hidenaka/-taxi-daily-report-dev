// 使い方動画のインライン展開プレイヤー。
// 既存 help-toggle.js と同じイベント委譲方式。
// ページ読込時は「▶ボタン + 空コンテナ」だけが存在し、動画/サムネは0バイト。
// ▶タップ → コンテナ展開＋ポスター注入（サムネ読込）。
// ▶(再生)タップ → video 要素を生成して再生（動画ダウンロード開始）。
// 使い方:
//   <button class="help-video-btn" data-help-video="KEY">▶ 使い方（15秒）</button>
//   <div class="help-video" id="help-video-KEY"></div>
import { HELP_VIDEOS } from './help-video-registry.js';

export function getVideoEntry(key, registry = HELP_VIDEOS) {
  return (key && registry[key]) ? registry[key] : null;
}

export function buildPlayerHTML(entry) {
  return (
    '<div class="hv-player">' +
      '<img class="hv-poster" src="' + entry.poster + '" alt="" ' +
        'onerror="this.closest(\'.hv-player\').classList.add(\'hv-error\')">' +
      '<button class="hv-play" type="button" aria-label="再生">▶</button>' +
      '<div class="hv-fallback">動画は準備中です</div>' +
    '</div>' +
    '<p class="hv-cap">' + entry.caption + '</p>' +
    '<button class="hv-close" type="button">折りたたむ</button>'
  );
}

export function buildVideoTag(entry) {
  return (
    '<video class="hv-video" src="' + entry.src + '" poster="' + entry.poster + '" ' +
    'controls autoplay muted playsinline preload="auto"></video>' +
    '<p class="hv-cap">' + entry.caption + '</p>' +
    '<button class="hv-close" type="button">折りたたむ</button>'
  );
}

function keyOf(container) {
  return container.id.replace(/^help-video-/, '');
}

function triggerFor(key) {
  return document.querySelector('.help-video-btn[data-help-video="' + key + '"]');
}

function toggle(key) {
  const container = document.getElementById('help-video-' + key);
  if (!container) return;
  const entry = getVideoEntry(key);
  if (!entry) return;
  const willOpen = !container.classList.contains('open');
  const btn = triggerFor(key);
  if (willOpen) {
    if (!container.innerHTML.trim()) container.innerHTML = buildPlayerHTML(entry);
    container.classList.add('open');
    if (btn) btn.classList.add('open');
  } else {
    closeVideo(container);
  }
}

function startVideo(container) {
  if (!container) return;
  const entry = getVideoEntry(keyOf(container));
  if (!entry) return;
  container.innerHTML = buildVideoTag(entry); // ここで初めて動画をダウンロード
}

function closeVideo(container) {
  if (!container) return;
  container.classList.remove('open');
  container.innerHTML = ''; // video を破棄＝再生停止・メモリ解放
  const btn = triggerFor(keyOf(container));
  if (btn) btn.classList.remove('open');
}

// DOM 委譲（node テスト環境では document 不在なのでスキップ）
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.help-video-btn');
    if (trigger) { toggle(trigger.getAttribute('data-help-video')); return; }
    const play = e.target.closest('.hv-play');
    if (play) { startVideo(play.closest('.help-video')); return; }
    const close = e.target.closest('.hv-close');
    if (close) { closeVideo(close.closest('.help-video')); return; }
  });
}

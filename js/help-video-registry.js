// 使い方動画の登録表。動画追加はここに1行足すだけ。
// src/poster はページ(ルート直下のhtml)からの相対パス。
export const HELP_VIDEOS = {
  'home': {
    src: 'media/help/home.mp4',
    poster: 'media/help/home.jpg',
    caption: 'ホーム画面の見方（手取り目標・出番・カレンダー）',
  },
  'input-paste': {
    src: 'media/help/input-paste.mp4',
    poster: 'media/help/input-paste.jpg',
    caption: '日報を貼って取り込む手順',
  },
  'ocr-import': {
    src: 'media/help/ocr-import.mp4',
    poster: 'media/help/ocr-import.jpg',
    caption: '写真を撮って取り込む手順',
  },
  'calendar': {
    src: 'media/help/calendar.mp4',
    poster: 'media/help/calendar.jpg',
    caption: 'シフトカレンダーで出番予定を入れる手順',
  },
  'analysis-view': {
    src: 'media/help/analysis-view.mp4',
    poster: 'media/help/analysis-view.jpg',
    caption: '分析ページの見方（数字の読み方）',
  },
  'arrivals': {
    // tools/ サブディレクトリ配下のページから使うため ../media/help/ で参照
    src: '../media/help/arrivals.mp4',
    poster: '../media/help/arrivals.jpg',
    caption: '到着便の予測と便一覧の見方',
  },
};

#!/usr/bin/env bash
# 使い方動画の圧縮ツール。
# 例: scripts/compress-help-video.sh ~/Downloads/rec.mov media/help/ocr-import.mp4
# 出力: 無音・縦・H.264 のMP4 と、同名 .jpg のサムネ。
set -euo pipefail

IN="${1:?usage: compress-help-video.sh <input.mov> <media/help/<key>.mp4>}"
OUT="${2:?usage: compress-help-video.sh <input.mov> <media/help/<key>.mp4>}"
POSTER="${OUT%.mp4}.jpg"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg が必要です（brew install ffmpeg）" >&2
  exit 1
fi

# 横幅を最大480pxへ縮小（縦は自動・偶数化）。無音。faststartで先頭から即再生。
ffmpeg -y -i "$IN" -an \
  -vf "scale='min(480,iw)':-2" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 28 -preset slow \
  -movflags +faststart "$OUT"

# サムネ（0.5秒地点の1フレーム）
ffmpeg -y -ss 0.5 -i "$IN" -frames:v 1 -vf "scale='min(480,iw)':-2" -q:v 4 "$POSTER"

echo "done:"
echo "  video : $OUT ($(du -h "$OUT" | cut -f1))"
echo "  poster: $POSTER ($(du -h "$POSTER" | cut -f1))"
echo "目標: 動画は数百KB〜1MB。超える場合は -crf を 30〜32 に上げて再実行。"

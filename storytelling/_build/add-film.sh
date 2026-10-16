#!/bin/bash
# Encode a finished film for /storytelling: 720p h264 faststart + a 1280x720 poster.
# Usage:  bash storytelling/_build/add-film.sh "<source.mov>" <slug> [poster-seconds]
# Then add a .film tile in storytelling/index.html pointing at assets/<slug>.mp4 + assets/poster-<slug>.jpg
set -e
SRC="$1"; SLUG="$2"; T="${3:-2}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ffmpeg -v error -y -i "$SRC" -vf "scale=1280:720" -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 112k "$HERE/assets/$SLUG.mp4"
ffmpeg -v error -y -ss "$T" -i "$SRC" -frames:v 1 -vf "scale=1280:720" -q:v 3 "$HERE/assets/poster-$SLUG.jpg"
ls -la "$HERE/assets/$SLUG.mp4" "$HERE/assets/poster-$SLUG.jpg"

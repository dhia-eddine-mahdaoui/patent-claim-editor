#!/usr/bin/env bash
# Converts .tmp/demo.webm into docs/demo.gif (and docs/demo.mp4) using a static ffmpeg from the
# imageio-ffmpeg wheel, installed into a throwaway virtualenv under .tmp (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .tmp/venv/bin/python ]; then
  python3 -m venv .tmp/venv
  .tmp/venv/bin/pip install --quiet imageio-ffmpeg
fi
FFMPEG=$(.tmp/venv/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
START=${DEMO_START:-0.9}
SPEED=${DEMO_SPEED:-1.25}
FILTERS="setpts=PTS/${SPEED},fps=10,scale=900:-1:flags=lanczos"
nice -n 10 "$FFMPEG" -y -loglevel error -ss "$START" -i .tmp/demo.webm \
  -vf "$FILTERS,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 docs/demo.gif
nice -n 10 "$FFMPEG" -y -loglevel error -ss "$START" -i .tmp/demo.webm \
  -vf "setpts=PTS/${SPEED},scale=1280:-2,fps=30" -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -an docs/demo.mp4 || true
ls -l docs/demo.gif docs/demo.mp4

#!/usr/bin/env bash
# encode-demo.sh — turn the captured .webm into committed demo assets:
#   media/meridian-demo.mp4  (H.264, broadly playable)
#   media/meridian-demo.gif  (README-embeddable, palette-optimized)
#
# Uses the ffmpeg that ships with Playwright's browser bundle — no extra install.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REC="$ROOT/scripts/.rec"
OUT="$ROOT/media"
# A full ffmpeg (libx264 + gif + palettegen). Playwright's bundled ffmpeg only
# does VP8/webm, so we use the one shipped inside the @ffmpeg-installer npm tarball
# (installed alongside playwright — throwaway, gitignored).
FFMPEG="$(node -e "process.stdout.write(require('@ffmpeg-installer/ffmpeg').path)" 2>/dev/null || true)"
[ -x "${FFMPEG:-}" ] || FFMPEG="$(command -v ffmpeg || true)"
[ -x "${FFMPEG:-}" ] || { echo "no full ffmpeg found — run: npm i @ffmpeg-installer/ffmpeg"; exit 1; }
echo "ffmpeg: $FFMPEG"

WEBM="$(ls -1t "$REC"/*.webm 2>/dev/null | head -n1)"
[ -n "${WEBM:-}" ] || { echo "no .webm in $REC — run: node scripts/record-demo.mjs"; exit 1; }
mkdir -p "$OUT"
echo "source: $WEBM"

# MP4 — even dimensions required for yuv420p / H.264.
"$FFMPEG" -y -i "$WEBM" \
  -movflags +faststart -pix_fmt yuv420p -c:v libx264 -crf 23 -preset medium \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  "$OUT/meridian-demo.mp4"

# GIF — two-pass palette for clean color at a README-friendly file size
# (width 800, 12fps, single diff-optimized palette).
PAL="$REC/palette.png"
GIF_FILT="fps=12,scale=800:-1:flags=lanczos"
"$FFMPEG" -y -i "$WEBM" -vf "$GIF_FILT,palettegen=max_colors=128:stats_mode=diff" "$PAL"
"$FFMPEG" -y -i "$WEBM" -i "$PAL" \
  -lavfi "$GIF_FILT [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle:new=1" \
  "$OUT/meridian-demo.gif"

echo "--- outputs ---"
ls -la "$OUT/meridian-demo.mp4" "$OUT/meridian-demo.gif"

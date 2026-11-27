#!/usr/bin/env bash
# README GIF from an MP4: palette-optimized, looping, under a size budget.
#
#   make_gif.sh <in.mp4> <out.gif> [--width 960] [--fps 15] [--max-mb 5]
#
# Steps down (fps 15 → 12 → 10, then width 960 → 800 → 720) until the GIF fits --max-mb.
# A palette per GIF (stats_mode=diff favours what moves) + bayer dithering keeps UI text sharp
# and the file small; diff_mode=rectangle only re-encodes the changed part of each frame.
set -euo pipefail
[ $# -ge 2 ] || { sed -n '2,7p' "$0"; exit 2; }
in=$1 out=$2; shift 2
width=960 fps=15 max_mb=5
while [ $# -gt 0 ]; do
  case $1 in
    --width) width=$2; shift ;;
    --fps) fps=$2; shift ;;
    --max-mb) max_mb=$2; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -f "$in" ] || { echo "no such file: $in" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
max_bytes=$(awk -v m="$max_mb" 'BEGIN{printf "%d", m*1024*1024}')

encode() { # fps width
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$in" -filter_complex \
    "fps=$1,scale=$2:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "$out"
}
size() { wc -c < "$out" | tr -d ' '; }

tries="$fps:$width 12:$width 10:$width 10:800 10:720 8:640"
for t in $tries; do
  f=${t%%:*} w=${t##*:}
  [ "$f" -le "$fps" ] && [ "$w" -le "$width" ] || continue
  encode "$f" "$w"
  if [ "$(size)" -le "$max_bytes" ]; then
    echo "  → $out ($(awk -v b="$(size)" 'BEGIN{printf "%.1f", b/1048576}') MB, ${w}px, ${f} fps)"
    exit 0
  fi
done
echo "  → $out ($(awk -v b="$(size)" 'BEGIN{printf "%.1f", b/1048576}') MB - over ${max_mb} MB even at 640px/8fps; trim the scene)" >&2

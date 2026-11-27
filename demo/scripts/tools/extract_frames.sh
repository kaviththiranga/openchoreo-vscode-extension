#!/usr/bin/env bash
# Pull still frames for the visual check, plus one contact sheet.
#
#   extract_frames.sh <video> <out-dir> <timeline.json>     # scene starts + key moments
#   extract_frames.sh <video> <out-dir> 1.5 4.2 9           # explicit times (seconds)
#   extract_frames.sh <video> <out-dir> --every 2           # one frame every N seconds
#
# Writes <out-dir>/NNN-<label>.png, <out-dir>/contact-sheet.png and <out-dir>/index.txt.
set -euo pipefail

[ $# -ge 3 ] || { sed -n '2,8p' "$0"; exit 2; }
video=$1 out=$2; shift 2
command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
[ -f "$video" ] || { echo "no such video: $video" >&2; exit 1; }
mkdir -p "$out"
rm -f "$out"/[0-9][0-9][0-9]-*.png "$out/contact-sheet.png" "$out/index.txt"

duration() {
  if command -v ffprobe >/dev/null; then
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"
  else
    { ffmpeg -hide_banner -i "$1" 2>&1 || true; } | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p' | awk -F: '{print $1*3600+$2*60+$3}'
  fi
}

# Build "label<TAB>seconds" lines.
points=$(mktemp); trap 'rm -rf "$points" "${seq_dir:-}"' EXIT
if [ "$1" = "--every" ]; then
  step=${2:-2}; dur=$(duration "$video")
  awk -v d="$dur" -v s="$step" 'BEGIN{for(t=0.5;t<d;t+=s) printf "t%05.1f\t%.2f\n", t, t}' > "$points"
elif [ -f "$1" ]; then
  node -e '
    const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const p of t.points) console.log(`${p.label}\t${p.t}`);
  ' "$1" > "$points"
else
  for t in "$@"; do printf 't%s\t%s\n' "$t" "$t"; done > "$points"
fi

n=0
while IFS=$'\t' read -r label t; do
  n=$((n + 1))
  file=$(printf '%s/%03d-%s.png' "$out" "$n" "$label")
  ffmpeg -nostdin -hide_banner -loglevel error -y -ss "$t" -i "$video" -frames:v 1 "$file"
  printf '%03d  %6ss  %s\n' "$n" "$t" "$label" >> "$out/index.txt"
done < "$points"

# Contact sheet: thumbnails in a grid, numbered in index.txt order.
seq_dir=$(mktemp -d)
i=0
for f in "$out"/[0-9][0-9][0-9]-*.png; do i=$((i + 1)); cp "$f" "$(printf '%s/%03d.png' "$seq_dir" "$i")"; done
if [ "$i" -gt 0 ]; then
  read -r w h < <({ ffmpeg -hide_banner -i "$seq_dir/001.png" 2>&1 || true; } | sed -n 's/.* \([0-9]\{2,5\}\)x\([0-9]\{2,5\}\).*/\1 \2/p' | head -1)
  if [ "${w:-16}" -ge "${h:-9}" ]; then cols=4; scale="scale=640:-2"; else cols=6; scale="scale=-2:640"; fi
  rows=$(( (i + cols - 1) / cols ))
  label=""
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext '; then
    label=",drawtext=text='%{eif\:n+1\:d}':x=12:y=12:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8"
  fi
  ffmpeg -nostdin -hide_banner -loglevel error -y -framerate 1 -i "$seq_dir/%03d.png" \
    -vf "${scale}${label},tile=${cols}x${rows}:padding=8:margin=8:color=0x222222" -frames:v 1 "$out/contact-sheet.png"
fi

echo "frames: $n → $out (contact-sheet.png, index.txt)"

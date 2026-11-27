#!/usr/bin/env bash
# Find black and frozen stretches - hints for the visual check, not a verdict.
# Holds on key moments are fine; a freeze anywhere else usually means a spinner,
# a hung page, or a recorder that started too early.
#
#   detect_issues.sh <video> [timeline.json] [min-freeze-seconds]
set -euo pipefail

video=${1:?usage: detect_issues.sh <video> [timeline.json] [min-freeze-seconds]}
timeline=${2:-}
min_freeze=${3:-2.5}

log=$(ffmpeg -nostdin -hide_banner -i "$video" \
  -vf "blackdetect=d=0.4:pic_th=0.97,freezedetect=n=0.001:d=${min_freeze}" -an -f null - 2>&1 || true)

echo "== black frames (>= 0.4s)"
grep -o 'black_start:[0-9.]* black_end:[0-9.]* black_duration:[0-9.]*' <<<"$log" || echo "none"

echo "== frozen video (>= ${min_freeze}s)"
freezes=$(paste -d' ' \
  <(grep -o 'freeze_start: [0-9.]*' <<<"$log" | awk '{print $2}') \
  <(grep -o 'freeze_end: [0-9.]*' <<<"$log" | awk '{print $2}') || true)
if [ -z "$freezes" ]; then echo "none"; exit 0; fi

if [ -n "$timeline" ] && [ -f "$timeline" ]; then
  # Label each freeze with its scene and whether it covers the key moment (expected hold).
  node -e '
    const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const lines = process.argv[2].trim().split("\n");
    for (const l of lines) {
      const [a, b] = l.split(" ").map(Number);
      const end = Number.isFinite(b) ? b : t.duration_s;
      const s = t.scenes.find((s) => a < s.end_s && end > s.start_s);
      const where = s ? s.id : a < (t.scenes[0]?.start_s ?? 0) ? "intro" : "outro";
      const hold = s && s.key_s >= a - 0.5 && s.key_s <= end + 0.5;
      const card = !s;
      const verdict = card ? "ok (title card)" : hold ? "ok? (key-moment hold)" : "CHECK";
      console.log(`${a.toFixed(2)}s-${end.toFixed(2)}s  ${(end - a).toFixed(1)}s  ${where.padEnd(22)} ${verdict}`);
    }
  ' "$timeline" "$freezes"
else
  awk '{printf "%ss-%ss\n", $1, ($2 == "" ? "end" : $2)}' <<<"$freezes"
fi

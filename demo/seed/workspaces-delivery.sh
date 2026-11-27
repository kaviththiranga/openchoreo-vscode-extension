#!/usr/bin/env bash
# Workspace for the delivery scenes (builds, releases, promotion, rollback).
# They drive the OpenChoreo sidebar, so the folder only gives the window a
# neutral name: no OpenChoreo YAML (which would make it a GitOps repository
# and add GitOps menu items) and no git repository (no linked component).
# Idempotent, bash 3.2-safe, Linux and macOS.
#   DEMO_WS_ROOT  parent folder (default ~/demo-ws)
set -eu
root="${DEMO_WS_ROOT:-$HOME/demo-ws}"
ws="$root/services"
rm -rf "$ws"
mkdir -p "$ws"
cat > "$ws/README.md" <<'MD'
# Services

Day-to-day delivery for the team's OpenChoreo services: builds, releases and promotions.
MD
echo "$ws"

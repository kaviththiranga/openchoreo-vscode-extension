#!/usr/bin/env bash
# Copyright 2026 The OpenChoreo Authors
# SPDX-License-Identifier: Apache-2.0
#
# Prepares the folders the explore scenes open (sidebar tour, edit and save,
# create resource, scaffold from source) and resets them to a clean state.
# Idempotent; bash 3.2 safe; Linux and macOS.
#
#   demo/seed/workspaces-explore.sh            # under $HOME/demo-ws/explore
#   DEMO_WS_ROOT=/some/dir demo/seed/workspaces-explore.sh
#
# Creates:
#   $DEMO_WS_ROOT/explore/url-shortener          the url-shortener sample's source (sidebar scenes)
#   $DEMO_WS_ROOT/explore/reading-list-service   a Flask service without OpenChoreo files, origin
#                                                github.com/acme/reading-list-service (scaffold scene)
#   $DEMO_WS_ROOT/explore/occ-config             a copy of the demo occ login (OCC_SOURCE_CONFIG, else
#                                                $DEMO_WS_ROOT/.occ/default.config, else ~/.openchoreo/config),
#                                                so the namespace switch in the scenes leaves the original alone
set -euo pipefail

ROOT="${DEMO_WS_ROOT:-$HOME/demo-ws}/explore"
CACHE="${DEMO_WS_ROOT:-$HOME/demo-ws}/.cache/sample-workloads"
REPO=https://github.com/openchoreo/sample-workloads.git
PIN=5e379133f0be52fd946c56377bd3c9d234d84e35
# The demo login: the Mac keeps it in demo-ws/.occ, the cluster host in ~/.openchoreo.
OCC_SOURCE="${OCC_SOURCE_CONFIG:-}"
if [ -z "$OCC_SOURCE" ]; then
  OCC_SOURCE="${DEMO_WS_ROOT:-$HOME/demo-ws}/.occ/default.config"
  [ -f "$OCC_SOURCE" ] || OCC_SOURCE="$HOME/.openchoreo/config"
fi

mkdir -p "$ROOT" "$(dirname "$CACHE")"

if [ ! -d "$CACHE/.git" ]; then
  git clone -q --filter=blob:none --no-checkout "$REPO" "$CACHE"
fi
if ! git -C "$CACHE" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  git -C "$CACHE" fetch -q origin
fi
git -C "$CACHE" -c advice.detachedHead=false checkout -q -f "$PIN"

# A folder of its own with one commit, so it reads like a fresh clone of the service.
fresh_repo() {
  src="$1"
  dest="$2"
  shift 2
  rm -rf "$dest"
  mkdir -p "$dest"
  (cd "$CACHE/$src" && tar cf - .) | (cd "$dest" && tar xf -)
  for drop in "$@"; do rm -rf "${dest:?}/$drop"; done
  git -C "$dest" init -q -b main 2>/dev/null || { git -C "$dest" init -q && git -C "$dest" checkout -q -b main; }
  git -C "$dest" config user.name 'Demo Developer'
  git -C "$dest" config user.email 'dev@example.com'
  git -C "$dest" config commit.gpgsign false
  git -C "$dest" add -A
  git -C "$dest" commit -q -m 'Initial commit'
}

fresh_repo project-url-shortener "$ROOT/url-shortener"

# The scaffold scene starts from plain source: no OpenChoreo descriptors yet.
fresh_repo service-python-reading-list "$ROOT/reading-list-service" workload.yaml
# A remote, so the scaffolded Component points its build at a repository (nothing is pushed).
git -C "$ROOT/reading-list-service" remote add origin https://github.com/acme/reading-list-service.git

if [ -f "$OCC_SOURCE" ]; then
  cp "$OCC_SOURCE" "$ROOT/occ-config"
  chmod 600 "$ROOT/occ-config"
else
  echo "warning: no occ config at $OCC_SOURCE; set OCC_SOURCE_CONFIG" >&2
fi

echo "explore workspaces ready under $ROOT"

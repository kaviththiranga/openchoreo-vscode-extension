#!/usr/bin/env bash
# Copyright 2026 The OpenChoreo Authors
# SPDX-License-Identifier: Apache-2.0
#
# Prepares the folder the GitOps scenes open and resets it to a clean state.
# Idempotent; bash 3.2 safe; Linux and macOS.
#
#   demo/seed/workspaces-gitops.sh            # under $HOME/demo-ws
#   DEMO_WS_ROOT=/some/dir demo/seed/workspaces-gitops.sh
#
# Creates:
#   $DEMO_WS_ROOT/shop-gitops               a clone of the sample-gitops fork that Flux syncs into
#                                           the gitops-demo namespace, at a pinned commit, sparse:
#                                           namespaces/gitops-demo and platform-shared/component-types
#                                           (occ needs the ClusterComponentType to render releases).
#                                           Pushing is disabled (remote.origin.pushurl), commits stay local.
#   $DEMO_WS_ROOT/.occ/gitops-demo.config   the demo occ login (OCC_BASE_CONFIG, else
#                                           $DEMO_WS_ROOT/.occ/default.config, else ~/.openchoreo/config)
#                                           with its current context on namespace gitops-demo, project
#                                           shop (mode 600) — pass it as OCC_CONFIG
#
# The scenes reset the clone themselves before each take (scenes/gitops/workspace.ts) and create
# the cluster-only Environment "qa" the sync view shows, so this script is needed once per machine,
# or to start over.
set -euo pipefail

ROOT="${DEMO_WS_ROOT:-$HOME/demo-ws}"
WS="$ROOT/shop-gitops"
REPO="${GITOPS_REPO:-https://github.com/kaviththiranga/sample-gitops.git}"
PIN="${GITOPS_PIN:-e67af0f6fa5bdffb260492f77e56f6b1de3e3f20}"
# The demo login: the Mac keeps it in demo-ws/.occ, the cluster host in ~/.openchoreo.
OCC_SOURCE="${OCC_BASE_CONFIG:-}"
if [ -z "$OCC_SOURCE" ]; then
  OCC_SOURCE="$ROOT/.occ/default.config"
  [ -f "$OCC_SOURCE" ] || OCC_SOURCE="$HOME/.openchoreo/config"
fi
OCC_TARGET="$ROOT/.occ/gitops-demo.config"

mkdir -p "$ROOT"

if [ ! -d "$WS/.git" ]; then
  rm -rf "$WS"
  git clone -q --no-checkout "$REPO" "$WS"
fi
if ! git -C "$WS" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  git -C "$WS" fetch -q origin
fi
git -C "$WS" sparse-checkout init --cone
git -C "$WS" sparse-checkout set namespaces/gitops-demo platform-shared/component-types
git -C "$WS" checkout -q -f -B main "$PIN"
git -C "$WS" branch -q --set-upstream-to=origin/main main 2>/dev/null || true
git -C "$WS" reset -q --hard "$PIN"
git -C "$WS" clean -q -fdx
for branch in $(git -C "$WS" for-each-ref --format='%(refname:short)' refs/heads); do
  [ "$branch" = main ] || git -C "$WS" branch -q -D "$branch"
done
git -C "$WS" config user.name 'Demo Developer'
git -C "$WS" config user.email 'dev@example.com'
git -C "$WS" config commit.gpgsign false
# The scenes show "Push and Open Pull Request" but never click it; make sure nothing can be pushed.
git -C "$WS" config remote.origin.pushurl 'no-push://demo-workspace'

if [ -f "$OCC_SOURCE" ]; then
  mkdir -p "$(dirname "$OCC_TARGET")"
  chmod 700 "$(dirname "$OCC_TARGET")"
  # Point the current context at gitops-demo / shop; everything else is copied as is.
  awk '
    /^currentContext:/ { current = $2 }
    /^[^ #-]/ { inContexts = ($0 ~ /^contexts:/) }
    inContexts && /^  - name:/ { mine = ($3 == current) }
    inContexts && mine && /^    namespace:/ { print "    namespace: gitops-demo"; print "    project: shop"; next }
    inContexts && mine && /^    (project|component|resource):/ { next }
    { print }
  ' "$OCC_SOURCE" > "$OCC_TARGET.tmp"
  grep -q '^    namespace: gitops-demo' "$OCC_TARGET.tmp" || echo "warning: the current context in $OCC_SOURCE has no namespace line; set namespace gitops-demo, project shop in $OCC_TARGET" >&2
  mv "$OCC_TARGET.tmp" "$OCC_TARGET"
  chmod 600 "$OCC_TARGET"
else
  echo "warning: no occ config at $OCC_SOURCE; set OCC_BASE_CONFIG" >&2
fi

echo "gitops workspace ready: $WS (OCC_CONFIG=$OCC_TARGET)"

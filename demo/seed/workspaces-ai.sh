#!/usr/bin/env bash
# Copyright 2026 The OpenChoreo Authors
# SPDX-License-Identifier: Apache-2.0
#
# Prepares the folder the AI scenes open (MCP servers, customizations, other
# agents, chat hand-offs) and resets it to a clean state. Idempotent; bash 3.2
# safe; Linux and macOS.
#
#   demo/seed/workspaces-ai.sh                 # under $HOME/demo-ws/ai
#   DEMO_WS_ROOT=/some/dir demo/seed/workspaces-ai.sh
#
# Creates $DEMO_WS_ROOT/ai/snip-api-service: the url-shortener sample's API
# service as a repository of its own, with its OpenChoreo Component and
# Workload in .openchoreo/ (as "Scaffold Component from this Project" writes
# them, matching snip-api-service on the demo cluster). An uncommitted edit adds
# a dependency on the analytics service with "visibility" misspelled, for the
# Fix with Copilot scenes. App manifests only, so the folder is not treated as
# a GitOps repository, and no git remote, so it is not a linked component.
set -euo pipefail

ROOT="${DEMO_WS_ROOT:-$HOME/demo-ws}/ai"
CACHE="${DEMO_WS_ROOT:-$HOME/demo-ws}/.cache/sample-workloads"
REPO=https://github.com/openchoreo/sample-workloads.git
PIN=5e379133f0be52fd946c56377bd3c9d234d84e35
WS="$ROOT/snip-api-service"

mkdir -p "$ROOT" "$(dirname "$CACHE")"
# Shared with other seed scripts: only fetch into it and read with git archive,
# never check out, so parallel runs don't trip over each other.
if [ ! -d "$CACHE/.git" ]; then
  git clone -q --filter=blob:none --no-checkout "$REPO" "$CACHE"
fi
if ! git -C "$CACHE" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  git -C "$CACHE" fetch -q origin
fi

rm -rf "$WS"
mkdir -p "$WS/.openchoreo"
git -C "$CACHE" archive "$PIN" project-url-shortener/api-service | tar -x -C "$WS" --strip-components=2
rm -f "$WS/workload.yaml"

cat > "$WS/.openchoreo/component.yaml" <<'YAML'
apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: snip-api-service
  namespace: default
spec:
  owner:
    projectName: url-shortener
  componentType:
    kind: ClusterComponentType
    name: deployment/service
  autoDeploy: true
YAML

cat > "$WS/.openchoreo/workload.yaml" <<'YAML'
apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: snip-api-service
  namespace: default
spec:
  owner:
    projectName: url-shortener
    componentName: snip-api-service
  container:
    image: cr.openchoreo.dev/openchoreo/samples/snip-api-service:latest
    env:
      - key: PORT
        value: "8080"
      - key: RATE_LIMIT_PER_MINUTE
        value: "120"
  endpoints:
    http:
      type: HTTP
      port: 8080
  dependencies:
    endpoints:
      - component: snip-redis
        name: tcp
        project: url-shortener
        visibility: project
        envBindings:
          address: REDIS_ADDR
    resources:
      - ref: snip-postgres
        envBindings:
          url: POSTGRES_DSN
YAML

git -C "$WS" init -q -b main 2>/dev/null || { git -C "$WS" init -q && git -C "$WS" checkout -q -b main; }
git -C "$WS" config user.name 'Demo Developer'
git -C "$WS" config user.email 'dev@example.com'
git -C "$WS" config commit.gpgsign false
git -C "$WS" add -A
git -C "$WS" commit -q -m 'Initial commit'

# Work in progress: call the analytics service too, with "visibility" misspelled.
WL="$WS/.openchoreo/workload.yaml"
awk '
  { print }
  /address: REDIS_ADDR/ {
    print "      - component: snip-analytics-service"
    print "        name: http"
    print "        project: url-shortener"
    print "        visibilty: project"
    print "        envBindings:"
    print "          address: ANALYTICS_ADDR"
  }
' "$WL" > "$WL.tmp"
mv "$WL.tmp" "$WL"

echo "$WS"

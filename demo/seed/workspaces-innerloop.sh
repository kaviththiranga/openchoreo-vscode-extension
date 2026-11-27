#!/usr/bin/env bash
# Copyright 2026 The OpenChoreo Authors
# SPDX-License-Identifier: Apache-2.0
#
# Prepares the folders the inner-loop scenes open and resets them to a clean
# state. Idempotent; bash 3.2 safe; Linux and macOS. Needs git and network
# access to github.com.
#
#   demo/seed/workspaces-innerloop.sh            # under $HOME/demo-ws/innerloop
#   DEMO_WS_ROOT=/some/dir demo/seed/workspaces-innerloop.sh
#
# Creates:
#   $ROOT/sample-workloads        clone of openchoreo/sample-workloads on main at a pinned
#                                 commit; pushes go to $ROOT/.remote/sample-workloads.git.
#                                 linked-component opens it, build-this-commit and
#                                 follow-after-push open its service-go-greeter folder
#   $ROOT/snip-digest             a small Node job in the url-shortener project whose
#                                 workload.yaml depends on snip-api-service and
#                                 snip-analytics-service (run-locally, debug-against-env,
#                                 open-shell, runtime-logs, run-now)
#   $ROOT/url-shortener.code-workspace
#                                 a workspace with snip-digest (clone-source)
#   $ROOT/occ-home/.openchoreo/config
#                                 a copy of the demo occ login (OCC_SOURCE_CONFIG, else
#                                 $DEMO_WS_ROOT/.occ/default.config, else ~/.openchoreo/config).
#                                 Point OCC_CONFIG here: the extension hands occ terminals and
#                                 tunnels the folder above .openchoreo as HOME (only for a
#                                 <home>/.openchoreo/config path), so they find the login and get
#                                 the neutral prompt below instead of your own shell setup.
#   $ROOT/.mirror/sample-workloads.git
#                                 a shallow bare copy at the pinned commit (clone-source)
set -euo pipefail

ROOT="${DEMO_WS_ROOT:-$HOME/demo-ws}/innerloop"
REPO=https://github.com/openchoreo/sample-workloads.git
PIN=5e379133f0be52fd946c56377bd3c9d234d84e35
# The demo login: the Mac keeps it in demo-ws/.occ, the cluster host in ~/.openchoreo.
OCC_SOURCE="${OCC_SOURCE_CONFIG:-}"
if [ -z "$OCC_SOURCE" ]; then
  OCC_SOURCE="${DEMO_WS_ROOT:-$HOME/demo-ws}/.occ/default.config"
  [ -f "$OCC_SOURCE" ] || OCC_SOURCE="$HOME/.openchoreo/config"
fi

mkdir -p "$ROOT"

local_identity() {
  git -C "$1" config user.name 'Demo Developer'
  git -C "$1" config user.email 'dev@example.com'
  git -C "$1" config commit.gpgsign false
}

# --- linked components: a clone of the repository on main ---------------------
# Fetches come from GitHub (so the folder links to its components); pushes go to
# a bare repository next to it, so follow-after-push can push for real. The
# scenes move main of that bare repository and origin/main between HEAD^1
# (one push to make) and HEAD (pushed). Starts pushed.
CLONE="$ROOT/sample-workloads"
BARE="$ROOT/.remote/sample-workloads.git"
if [ ! -d "$CLONE/.git" ]; then
  rm -rf "$CLONE"
  git clone -q --filter=blob:none --no-checkout "$REPO" "$CLONE"
fi
if ! git -C "$CLONE" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  git -C "$CLONE" fetch -q origin
fi
git -C "$CLONE" remote set-url origin "$REPO"
git -C "$CLONE" checkout -q -f -B main "$PIN"
git -C "$CLONE" reset -q --hard "$PIN"
git -C "$CLONE" clean -q -fdx
local_identity "$CLONE"
rm -rf "$BARE"
mkdir -p "$(dirname "$BARE")"
git init -q --bare "$BARE"
git -C "$CLONE" push -q "$BARE" "$PIN:refs/heads/main"
git -C "$CLONE" remote set-url --push origin "$BARE"
git -C "$CLONE" update-ref refs/remotes/origin/main "$PIN"
git -C "$CLONE" branch -q --set-upstream-to=origin/main main

# --- snip-digest: a Node job wired to the url-shortener's services -----------
# A new url-shortener component, not deployed anywhere yet: occ remote only
# needs its workload.yaml to reach the services it depends on.
APP="$ROOT/snip-digest"
rm -rf "$APP"
mkdir -p "$APP/.vscode"
cat > "$APP/package.json" <<'EOF'
{
  "name": "snip-digest",
  "version": "0.1.0",
  "private": true,
  "description": "A team's most-clicked short links, for the weekly digest",
  "main": "digest.js",
  "scripts": {
    "start": "node digest.js"
  },
  "engines": {
    "node": ">=18"
  }
}
EOF
cat > "$APP/digest.js" <<'EOF'
// snip-digest: a team's most-clicked short links, for the weekly digest.
// API_SERVICE_URL and ANALYTICS_SERVICE_URL come from the dependencies in workload.yaml.
const team = process.env.SNIP_TEAM || 'devrel';
const apiUrl = process.env.API_SERVICE_URL || 'http://localhost:8080';
const analyticsUrl = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8081';

async function loadDigest() {
  const url = `${analyticsUrl}/api/analytics/user/${team}`;
  const res = await fetch(url);
  const digest = await res.json();
  return digest;
}

async function main() {
  const health = await (await fetch(`${apiUrl}/health`)).json();
  const digest = await loadDigest();

  console.log(`snip-digest for ${team}: ${digest.total_urls} links, ${digest.total_clicks} clicks`);
  console.log(`  api-service        ${apiUrl}  ${health.status}`);
  console.log(`  analytics-service  ${analyticsUrl}`);
  for (const link of digest.urls.slice(0, 5)) {
    console.log(`  ${String(link.click_count).padStart(4)}  /r/${link.short_code.padEnd(18)}${link.original_url}`);
  }
}

main().catch((err) => {
  console.error(`snip-digest: ${err.message}`);
  process.exit(1);
});
EOF
cat > "$APP/workload.yaml" <<'EOF'
apiVersion: openchoreo.dev/v1alpha1
kind: Workload
metadata:
  name: snip-digest
  namespace: default
spec:
  owner:
    projectName: url-shortener
    componentName: snip-digest
  container:
    image: ghcr.io/openchoreo/samples/snip-digest:latest
    env:
      - key: SNIP_TEAM
        value: devrel
  dependencies:
    endpoints:
      - project: url-shortener
        component: snip-api-service
        name: http
        visibility: project
        envBindings:
          address: API_SERVICE_URL
      - project: url-shortener
        component: snip-analytics-service
        name: http
        visibility: project
        envBindings:
          address: ANALYTICS_SERVICE_URL
EOF
cat > "$APP/.vscode/launch.json" <<'EOF'
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "snip-digest",
      "program": "${workspaceFolder}/digest.js",
      "skipFiles": ["<node_internals>/**"],
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
EOF
cat > "$APP/README.md" <<'EOF'
# snip-digest

A team's most-clicked short links, for the weekly digest. Reads the
`snip-api-service` and `snip-analytics-service` endpoints declared in `workload.yaml`.

```bash
npm start
```
EOF
cat > "$APP/.gitignore" <<'EOF'
node_modules/
EOF
git -C "$APP" init -q -b main 2>/dev/null || { git -C "$APP" init -q && git -C "$APP" checkout -q -b main; }
local_identity "$APP"
git -C "$APP" add -A
git -C "$APP" commit -q -m 'Weekly digest of top links'

# --- clone-source: a multi-root workspace holding snip-digest ----------------
# Clone Source adds the clone to it; a workspace that is already multi-root
# takes the new folder without restarting the extension host.
printf '{\n  "folders": [\n    {\n      "path": "snip-digest"\n    }\n  ]\n}\n' > "$ROOT/url-shortener.code-workspace"

# --- occ home: the occ login, and a neutral shell for occ terminals ----------
OCC_HOME="$ROOT/occ-home"
mkdir -p "$OCC_HOME/.openchoreo"
if [ -f "$OCC_SOURCE" ]; then
  cp "$OCC_SOURCE" "$OCC_HOME/.openchoreo/config"
  chmod 600 "$OCC_HOME/.openchoreo/config"
else
  echo "warning: no occ config at $OCC_SOURCE; set OCC_SOURCE_CONFIG" >&2
fi
printf '%s\n' "PS1='\\[\\e[1;32m\\]➜\\[\\e[0m\\] \\[\\e[1;36m\\]\\W\\[\\e[0m\\] '" > "$OCC_HOME/.bashrc"
printf '%s\n' '[ -f ~/.bashrc ] && . ~/.bashrc' > "$OCC_HOME/.bash_profile"
printf '%s\n' "PROMPT='%F{green}➜%f %F{cyan}%1~%f '" > "$OCC_HOME/.zshrc"
printf '[user]\n\tname = Demo Developer\n\temail = dev@example.com\n' > "$OCC_HOME/.gitconfig"
# Ubuntu's /etc/bash.bashrc prints a sudo hint in every shell until this file exists.
: > "$OCC_HOME/.sudo_as_admin_successful"

# --- clone-source: a shallow local copy of the repository --------------------
# The scene points git at it (url.insteadOf in VS Code's throwaway HOME), so
# Clone Source takes a second instead of downloading the whole repository.
MIRROR="$ROOT/.mirror/sample-workloads.git"
rm -rf "$MIRROR" "$ROOT/clones"
mkdir -p "$(dirname "$MIRROR")"
git clone -q --bare --depth 1 --branch main "file://$ROOT/sample-workloads" "$MIRROR"

echo "innerloop workspaces ready under $ROOT"

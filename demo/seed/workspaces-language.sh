#!/usr/bin/env bash
# Copyright 2026 The OpenChoreo Authors
# SPDX-License-Identifier: Apache-2.0
#
# Prepares the folders the language scenes open (completions, CEL, validation,
# hover and outline, bootstrap) and resets them to a clean state.
# Idempotent; bash 3.2 safe; Linux and macOS. Needs git and curl.
#
#   demo/seed/workspaces-language.sh            # under $HOME/demo-ws/language
#   DEMO_WS_ROOT=/some/dir demo/seed/workspaces-language.sh
#
# Creates (each a git repository with one commit):
#   $DEMO_WS_ROOT/language/url-shortener    the url-shortener sample's source plus its
#                                           OpenChoreo resources (the from-image sample the
#                                           cluster runs) in openchoreo/
#   $DEMO_WS_ROOT/language/platform-config  a platform team's repository: component types,
#                                           traits, environments and the pipeline, one per file
#
# The resources come from the OpenChoreo samples at v1.4.0-m.1, the cluster's version.
set -euo pipefail

WS="${DEMO_WS_ROOT:-$HOME/demo-ws}"
ROOT="$WS/language"
WORKLOADS_CACHE="$WS/.cache/sample-workloads"
WORKLOADS_REPO=https://github.com/openchoreo/sample-workloads.git
WORKLOADS_PIN=5e379133f0be52fd946c56377bd3c9d234d84e35
SAMPLES_TAG=v1.4.0-m.1
SAMPLES_CACHE="$WS/.cache/openchoreo-$SAMPLES_TAG"
SAMPLES_URL="https://raw.githubusercontent.com/openchoreo/openchoreo/$SAMPLES_TAG/samples"

mkdir -p "$ROOT" "$WS/.cache" "$SAMPLES_CACHE"

# sample-workloads, shared with the explore seed: clone into a temp dir and move it in,
# so two seeds running at once never clone into the same folder.
if [ ! -d "$WORKLOADS_CACHE/.git" ]; then
  tmp="$(mktemp -d "$WS/.cache/sample-workloads.XXXXXX")"
  git clone -q --filter=blob:none --no-checkout "$WORKLOADS_REPO" "$tmp"
  mv "$tmp" "$WORKLOADS_CACHE" 2>/dev/null || rm -rf "$tmp"
fi
if ! git -C "$WORKLOADS_CACHE" cat-file -e "$WORKLOADS_PIN^{commit}" 2>/dev/null; then
  git -C "$WORKLOADS_CACHE" fetch -q origin
fi

# A sample file at the pinned tag, cached.
sample() {
  rel="$1"
  file="$SAMPLES_CACHE/$rel"
  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")"
    curl -fsSL --retry 3 "$SAMPLES_URL/$rel" -o "$file.part"
    mv "$file.part" "$file"
  fi
  cat "$file"
}

# The first YAML document of a sample, without a leading `---` and trailing blank lines.
first_doc() {
  sample "$1" | awk 'NR == 1 && /^---/ { next } /^---/ { exit } { print }' | awk '
    /^[[:space:]]*$/ { blank++; next }
    { while (blank > 0) { print ""; blank-- } print }'
}

new_repo() {
  rm -rf "$1"
  mkdir -p "$1"
}

commit_repo() {
  dest="$1"
  git -C "$dest" init -q -b main 2>/dev/null || { git -C "$dest" init -q && git -C "$dest" checkout -q -b main; }
  git -C "$dest" config user.name 'Demo Developer'
  git -C "$dest" config user.email 'dev@example.com'
  git -C "$dest" config commit.gpgsign false
  git -C "$dest" add -A
  git -C "$dest" commit -q -m 'Initial commit'
}

# --- url-shortener: an app repository -------------------------------------------------
APP="$ROOT/url-shortener"
new_repo "$APP"
git -C "$WORKLOADS_CACHE" archive "$WORKLOADS_PIN" project-url-shortener | (cd "$APP" && tar xf - --strip-components=1)
mkdir -p "$APP/openchoreo/components" "$APP/openchoreo/resources" "$APP/openchoreo/bindings"
sample from-image/url-shortener/project.yaml > "$APP/openchoreo/project.yaml"
for c in api-service analytics-service frontend redis; do
  sample "from-image/url-shortener/components/$c.yaml" > "$APP/openchoreo/components/$c.yaml"
done
sample from-image/url-shortener/resources/postgres.yaml > "$APP/openchoreo/resources/postgres.yaml"
cat > "$APP/openchoreo/bindings/snip-frontend-production.yaml" <<'EOF'
apiVersion: openchoreo.dev/v1alpha1
kind: ReleaseBinding
metadata:
  name: snip-frontend-production
  namespace: default
spec:
  owner:
    projectName: url-shortener
    componentName: snip-frontend
  environment: production
  state: Active
  componentTypeEnvironmentConfigs:
    replicas: 2
EOF
commit_repo "$APP"

# --- platform-config: the platform team's repository ----------------------------------
PLATFORM="$ROOT/platform-config"
new_repo "$PLATFORM"
mkdir -p "$PLATFORM/component-types" "$PLATFORM/traits" "$PLATFORM/environments" "$PLATFORM/pipelines" "$PLATFORM/project-types"
first_doc getting-started/component-types/service.yaml > "$PLATFORM/component-types/service.yaml"
first_doc getting-started/component-types/webapp.yaml > "$PLATFORM/component-types/web-application.yaml"
first_doc getting-started/component-types/worker.yaml > "$PLATFORM/component-types/worker.yaml"
first_doc getting-started/component-types/scheduled-task.yaml > "$PLATFORM/component-types/scheduled-task.yaml"
first_doc getting-started/component-traits/hpa-trait.yaml > "$PLATFORM/traits/horizontal-pod-autoscaler.yaml"
first_doc getting-started/component-traits/vpa-trait.yaml > "$PLATFORM/traits/vertical-pod-autoscaler.yaml"
first_doc getting-started/component-traits/pvc-trait.yaml > "$PLATFORM/traits/persistent-volume-claim.yaml"
first_doc getting-started/component-traits/health-probes-trait.yaml > "$PLATFORM/traits/health-probes.yaml"
first_doc getting-started/cluster-project-types/default.yaml > "$PLATFORM/project-types/default.yaml"
first_doc getting-started/deployment-pipeline.yaml > "$PLATFORM/pipelines/default.yaml"
for env in development staging production; do
  sample getting-started/environments.yaml | awk -v env="$env" '
    /^---/ { if (found) exit; doc = ""; next }
    { doc = doc $0 "\n" }
    $0 == "  name: " env { found = 1 }
    END { if (found) printf "%s", doc }' > "$PLATFORM/environments/$env.yaml"
done
cat > "$PLATFORM/README.md" <<'EOF'
# platform-config

OpenChoreo platform configuration for the `default` namespace: the component types and
traits developers build on, the environments and the promotion pipeline.
EOF
commit_repo "$PLATFORM"

echo "language workspaces ready under $ROOT"

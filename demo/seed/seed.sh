#!/usr/bin/env bash
# seed.sh - seed the demo cluster for the OpenChoreo VS Code extension footage.
#
# Applies the advanced OpenChoreo samples at the cluster's version (v1.4.0-m.1) plus the
# manifests in ./manifests to namespace `default` (pipeline development -> staging -> production),
# promotes and re-releases a few components so the pipeline views have history, and kicks off
# real source builds (one deliberately failing). Idempotent: re-running converges on the same
# state without re-deploying what already exists. Bash 3.2-safe (macOS /bin/bash works).
#
# Usage:
#   ./seed.sh                 # every phase, in order
#   ./seed.sh <phase>...      # selected phases, e.g. ./seed.sh url-shortener promote
#   ./seed.sh teardown        # remove everything this script created (see README)
#
# Phases: access cleanup build-fixes url-shortener promote history scheduled-task configs
#         local-dev gcp traffic greeter-builds latency-lab status
#
# Environment:
#   KUBE_CONTEXT   kubectl context to use (default: current context)
#   OC_TAG         samples tag (default: v1.4.0-m.1, must match the cluster version)
#   SAMPLES_DIR    optional local copy whose samples/ folder is at OC_TAG; otherwise samples are
#                  fetched from raw.githubusercontent.com at OC_TAG
#   K3D_NODE       k3d node container for build-fixes (default: k3d-openchoreo-server-0)
#   WAIT_SECS      per-wait timeout in seconds (default: 600)
set -euo pipefail

OC_TAG="${OC_TAG:-v1.4.0-m.1}"
NS=default
K3D_NODE="${K3D_NODE:-k3d-openchoreo-server-0}"
WAIT_SECS="${WAIT_SECS:-600}"
RAW="https://raw.githubusercontent.com/openchoreo/openchoreo/${OC_TAG}/samples"
HERE="$(cd "$(dirname "$0")" && pwd)"
MANIFESTS="$HERE/manifests"
PART_OF="app.kubernetes.io/part-of=vscode-extension-demo"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[err] %s\033[0m\n' "$*" >&2; exit 1; }

kc() {
  if [ -n "${KUBE_CONTEXT:-}" ]; then kubectl --context "$KUBE_CONTEXT" "$@"; else kubectl "$@"; fi
}

# Print a sample file (path relative to samples/) at OC_TAG.
sample() {
  if [ -n "${SAMPLES_DIR:-}" ]; then
    cat "$SAMPLES_DIR/samples/$1"
  else
    curl -fsSL "$RAW/$1"
  fi
}

exists() { kc get "$1" "$2" -n "$NS" >/dev/null 2>&1; }

jp() { kc get "$1" "$2" -n "$NS" -o "jsonpath=$3" 2>/dev/null || true; }

# wait_until <description> <command...>: poll every 3s until the command succeeds.
wait_until() {
  local what="$1"; shift
  local waited=0
  until "$@" >/dev/null 2>&1; do
    [ "$waited" -ge "$WAIT_SECS" ] && die "timed out after ${WAIT_SECS}s waiting for: $what"
    sleep 3; waited=$((waited + 3))
  done
  info "ready: $what"
}

is_ready() {   # is_ready <kind> <name>
  [ "$(jp "$1" "$2" '{.status.conditions[?(@.type=="Ready")].status}')" = "True" ]
}

has_release() {   # has_release <component>  (autoDeploy has cut a ComponentRelease)
  [ -n "$(jp component "$1" '{.status.latestRelease.name}')" ]
}

has_resource_release() {   # has_resource_release <resource>
  [ -n "$(jp resource "$1" '{.status.latestRelease.name}')" ]
}

release_changed() {   # release_changed <component> <previous-release>
  local now; now="$(jp component "$1" '{.status.latestRelease.name}')"
  [ -n "$now" ] && [ "$now" != "$2" ]
}

binding_on_latest() {   # binding_on_latest <component>  (dev binding points at the latest release)
  local latest; latest="$(jp component "$1" '{.status.latestRelease.name}')"
  [ -n "$latest" ] && [ "$(jp releasebinding "$1-development" '{.spec.releaseName}')" = "$latest" ]
}

# Apply a Component (+ Workload, + anything else in the doc) only when the Component does not
# exist yet, so a re-run never resets a workload the demo (or the history phase) has changed.
apply_component_once() {   # apply_component_once <component> <manifest-producing command...>
  local comp="$1"; shift
  if exists component "$comp"; then info "component $comp exists - leaving it as is"; return 0; fi
  "$@" | kc apply -n "$NS" -f -
}

# Pin a Resource's binding to its latest ResourceRelease.
pin_resource() {   # pin_resource <resource> <binding>
  wait_until "resource $1 cut a release" has_resource_release "$1"
  local rel; rel="$(jp resource "$1" '{.status.latestRelease.name}')"
  [ "$(jp resourcereleasebinding "$2" '{.spec.resourceRelease}')" = "$rel" ] && return 0
  kc patch resourcereleasebinding "$2" -n "$NS" --type=merge -p "{\"spec\":{\"resourceRelease\":\"$rel\"}}"
}

# Create (or move) a component's binding in an environment to a given ComponentRelease.
bind_release() {   # bind_release <project> <component> <env> <release> [trait-yaml]
  local proj="$1" comp="$2" env="$3" rel="$4" traits="${5:-}"
  kc apply -n "$NS" -f - <<EOF
apiVersion: openchoreo.dev/v1alpha1
kind: ReleaseBinding
metadata:
  name: ${comp}-${env}
  namespace: ${NS}
  labels:
    app.kubernetes.io/part-of: vscode-extension-demo
spec:
  owner:
    projectName: ${proj}
    componentName: ${comp}
  environment: ${env}
  releaseName: ${rel}
  state: Active
${traits}
EOF
}

alert_traits() {   # alert_traits <trait-instance> <env>
  cat <<EOF
  traitEnvironmentConfigs:
    $1:
      enabled: true
      actions:
        notifications:
          channels:
            - webhook-notification-channel-$2
EOF
}

# Run a component build once (WorkflowRun named <component>-build-<suffix>), from the
# component's own workflow parameters unless a parameters JSON is passed.
run_build() {   # run_build <project> <component> <suffix> [parameters-json]
  local proj="$1" comp="$2" suffix="$3" params="${4:-}"
  local run="${comp}-build-${suffix}"
  if exists workflowrun "$run"; then info "workflowrun $run exists"; return 0; fi
  [ -n "$params" ] || params="$(jp component "$comp" '{.spec.workflow.parameters}')"
  [ -n "$params" ] || die "component $comp has no workflow parameters"
  kc apply -n "$NS" -f - <<EOF
apiVersion: openchoreo.dev/v1alpha1
kind: WorkflowRun
metadata:
  name: ${run}
  namespace: ${NS}
  labels:
    openchoreo.dev/project: "${proj}"
    openchoreo.dev/component: "${comp}"
    app.kubernetes.io/part-of: vscode-extension-demo
spec:
  workflow:
    kind: ClusterWorkflow
    name: dockerfile-builder
    parameters: ${params}
EOF
}

run_finished() {   # run_finished <workflowrun>
  [ "$(jp workflowrun "$1" '{.status.conditions[?(@.type=="WorkflowCompleted")].status}')" = "True" ]
}

wait_build() {   # wait_build <workflowrun>
  exists workflowrun "$1" || { warn "workflowrun $1 not found - skipping wait"; return 0; }
  wait_until "workflowrun $1 finished" run_finished "$1"
  info "$1: $(jp workflowrun "$1" '{.status.conditions[?(@.type=="WorkflowSucceeded")].reason}{.status.conditions[?(@.type=="WorkflowFailed")].reason}')"
}

# ---------------------------------------------------------------------------------------------

phase_access() {
  log "Demo write access for the occ quick-start client (platform-engineer)"
  kc apply -f "$HERE/demo-access.yaml"
}

phase_cleanup() {
  log "Removing junk left from earlier testing"
  kc delete component test -n "$NS" --ignore-not-found --wait=false
}

# Source builds on this host (kernel 5.15, k3d behind a DOCKER-USER/UFW firewall) need runtime
# patches; see README "Builds". Needs docker access to the k3d node for the node /etc/hosts entry,
# which does not survive a node restart - re-run this phase after one.
phase_build_fixes() {
  log "Source-build fixes (user namespaces off, registry reachable from build pods and the node)"
  local t reg
  for t in containerfile-build ballerina-buildpack-build gcp-buildpacks-build paketo-buildpacks-build; do
    kc patch clusterworkflowtemplate "$t" --type=json \
      -p '[{"op":"replace","path":"/spec/templates/0/podSpecPatch","value":"{\"hostUsers\": true}"}]' >/dev/null \
      && info "hostUsers=true on $t"
  done
  reg="$(kc get svc registry -n openchoreo-workflow-plane -o jsonpath='{.spec.clusterIP}')"
  [ -n "$reg" ] || die "registry service not found in openchoreo-workflow-plane"
  kc patch clusterworkflowtemplate publish-image --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/templates/0/podSpecPatch\",\"value\":\"{\\\"hostUsers\\\": true, \\\"hostAliases\\\": [{\\\"ip\\\": \\\"$reg\\\", \\\"hostnames\\\": [\\\"host.k3d.internal\\\"]}]}\"}]" >/dev/null \
    && info "publish-image pushes to host.k3d.internal:10082 -> registry ClusterIP $reg"
  # Build runs (and their logs) are deleted 1 day after they finish by default; keep the demo's
  # build history around for the recording window. The TTL is copied into each run at creation.
  kc patch clusterworkflow dockerfile-builder --type=merge -p '{"spec":{"ttlAfterCompletion":"30d"}}' >/dev/null \
    && info "dockerfile-builder runs kept for 30d"
  local r
  for r in $(kc get workflowrun -n "$NS" -o name); do
    kc patch "$r" -n "$NS" --type=merge -p '{"spec":{"ttlAfterCompletion":"30d"}}' >/dev/null
  done
  if command -v docker >/dev/null 2>&1 && docker inspect "$K3D_NODE" >/dev/null 2>&1; then
    docker exec "$K3D_NODE" sh -c \
      "grep -v host.k3d.internal /etc/hosts > /tmp/h; echo '$reg host.k3d.internal' >> /tmp/h; cat /tmp/h > /etc/hosts; rm -f /tmp/h"
    info "node $K3D_NODE pulls host.k3d.internal:10082 from registry ClusterIP $reg"
  else
    warn "no docker access to $K3D_NODE: run this phase on the k3d host so built images can be pulled"
  fi
}

phase_url_shortener() {
  log "url-shortener (from-image): project, Postgres resource, 4 components in development"
  sample getting-started/cluster-resource-types/postgres.yaml | kc apply -f -
  sample from-image/url-shortener/alerting-demo/alert-notification-channels.yaml | kc apply -f -
  kc apply -f "$MANIFESTS/alert-channels.yaml"
  sample from-image/url-shortener/project.yaml | kc apply -f -
  wait_until "projectreleasebinding url-shortener-development Ready" is_ready projectreleasebinding url-shortener-development
  if ! exists resource snip-postgres; then
    sample from-image/url-shortener/resources/postgres.yaml | kc apply -f -
  fi
  pin_resource snip-postgres snip-postgres-development
  exists releasebinding snip-frontend-development || \
    sample from-image/url-shortener/alerting-demo/enable-alert.yaml | kc apply -f -
  local c
  for c in redis api-service analytics-service frontend; do
    apply_component_once "snip-$c" sample "from-image/url-shortener/components/$c.yaml"
  done
  for c in snip-redis snip-api-service snip-analytics-service snip-frontend; do
    wait_until "$c released" has_release "$c"
  done
  wait_until "resourcereleasebinding snip-postgres-development Ready" is_ready resourcereleasebinding snip-postgres-development
}

# Promote url-shortener to staging and production at whatever development runs now. Existing
# bindings are left alone, so a re-run never undoes a later promotion or roll back.
phase_promote() {
  log "Promoting url-shortener to staging and production"
  local env c rel traits
  for env in staging production; do
    wait_until "projectreleasebinding url-shortener-$env Ready" is_ready projectreleasebinding "url-shortener-$env"
    if ! exists resourcereleasebinding "snip-postgres-$env"; then
      rel="$(jp resource snip-postgres '{.status.latestRelease.name}')"
      kc apply -n "$NS" -f - <<EOF
apiVersion: openchoreo.dev/v1alpha1
kind: ResourceReleaseBinding
metadata:
  name: snip-postgres-${env}
  namespace: ${NS}
  labels:
    app.kubernetes.io/part-of: vscode-extension-demo
spec:
  owner:
    projectName: url-shortener
    resourceName: snip-postgres
  environment: ${env}
  retainPolicy: Delete
  resourceRelease: ${rel}
EOF
    fi
    for c in snip-redis snip-api-service snip-analytics-service snip-frontend; do
      if exists releasebinding "$c-$env"; then info "$c-$env exists"; continue; fi
      rel="$(jp releasebinding "$c-development" '{.spec.releaseName}')"
      [ -n "$rel" ] || die "$c-development has no release yet"
      traits=""
      [ "$c" = snip-frontend ] && traits="$(alert_traits frontend-5xx-log-alert "$env")"
      bind_release url-shortener "$c" "$env" "$rel" "$traits"
    done
  done
  for env in staging production; do
    for c in snip-redis snip-api-service snip-analytics-service snip-frontend; do
      wait_until "releasebinding $c-$env Ready" is_ready releasebinding "$c-$env"
    done
  done
}

# Give two components a second release: development and staging move to it, production stays on
# the first one, so Compare Releases / Roll Back / Promote have something real to show.
phase_history() {
  log "Second releases for snip-api-service and snip-frontend (dev + staging on v2, prod on v1)"
  local c key val traits before
  for c in snip-api-service snip-frontend; do
    if [ "$c" = snip-api-service ]; then key=RATE_LIMIT_PER_MINUTE; val=120; else key=FEATURE_QR_CODES; val=true; fi
    # Already done on an earlier run: leave staging wherever a scene promoted or rolled it back to.
    if kc get workload "$c" -n "$NS" -o jsonpath='{.spec.container.env[*].key}' | tr ' ' '\n' | grep -qx "$key"; then
      info "$c already carries $key"
      continue
    fi
    before="$(jp component "$c" '{.status.latestRelease.name}')"
    kc patch workload "$c" -n "$NS" --type=json \
      -p "[{\"op\":\"add\",\"path\":\"/spec/container/env/-\",\"value\":{\"key\":\"$key\",\"value\":\"$val\"}}]"
    wait_until "$c cut a new release" release_changed "$c" "$before"
    wait_until "$c development on its latest release" binding_on_latest "$c"
    traits=""
    [ "$c" = snip-frontend ] && traits="$(alert_traits frontend-5xx-log-alert staging)"
    bind_release url-shortener "$c" staging "$(jp component "$c" '{.status.latestRelease.name}')" "$traits"
    wait_until "releasebinding $c-staging Ready" is_ready releasebinding "$c-staging"
  done
}

phase_scheduled_task() {
  log "github-issue-reporter scheduled task (project default)"
  apply_component_once github-issue-reporter sample from-image/issue-reporter-schedule-task/github-issue-reporter.yaml
  wait_until "github-issue-reporter released" has_release github-issue-reporter
}

phase_configs() {
  log "component-with-configs: demo-app (env vars, config files, secrets from OpenBao)"
  apply_component_once demo-app sample component-types/component-with-configs/component-with-configs.yaml
  wait_until "demo-app released" has_release demo-app
}

# occ remote / Run Locally providers from samples/local-development: a Postgres resource and a
# config bundle in project default, and the gRPC greeter in its own project. The sample's HTTP
# provider (project `greeter`, component `greeter-service`) is skipped: that component name is
# already taken by default/greeter-service on this cluster.
phase_local_dev() {
  log "local-development providers (local-dev-postgres, local-dev-config-bundle, grpc-greeter)"
  sample getting-started/cluster-resource-types/postgres.yaml | kc apply -f -
  sample local-development/config-bundle/type.yaml | kc apply -f -
  exists resource local-dev-postgres || {
    sample local-development/postgres/resource.yaml | kc apply -f -
    sample local-development/postgres/binding-development.yaml | kc apply -f -
  }
  exists resource local-dev-config-bundle || {
    sample local-development/config-bundle/resource.yaml | kc apply -f -
    sample local-development/config-bundle/binding-development.yaml | kc apply -f -
  }
  pin_resource local-dev-postgres local-dev-postgres-development
  pin_resource local-dev-config-bundle local-dev-config-bundle-development
  apply_component_once grpc-greeter sample local-development/dependant-comps/grpc-demo-project/grpc-greeter.yaml
}

# greeting-service (project default, samples/from-source/services/go-docker-greeter): one good
# build, then the samples/mcp/build-failures scenario - a build pointed at a Dockerfile that does
# not exist, for the Troubleshoot-a-failed-build scene.
phase_greeter_builds() {
  log "greeting-service builds: build-01 (succeeds), build-02 (fails: missing Dockerfile)"
  apply_component_once greeting-service sample from-source/services/go-docker-greeter/greeting-service.yaml
  run_build default greeting-service 01
  wait_build greeting-service-build-01
  run_build default greeting-service 02 '{"repository":{"url":"https://github.com/openchoreo/sample-workloads","revision":{"branch":"main"},"appPath":"/service-go-greeter"},"docker":{"context":"/service-go-greeter","filePath":"/service-go-greeter/Dockerfile.broken"}}'
}

# Latency Lab (samples/from-source/projects/latency-lab): six source-built components, built two
# at a time to keep the host responsive, plus the intentionally broken api-service variant.
phase_latency_lab() {
  log "latency-lab (from-source): project + 6 components built from github.com/openchoreo/sample-workloads"
  sample from-source/projects/latency-lab/project.yaml | kc apply -f -
  wait_until "projectreleasebinding latency-lab-development Ready" is_ready projectreleasebinding latency-lab-development
  exists releasebinding lab-frontend-development || kc apply -f "$MANIFESTS/latency-lab-alert.yaml"
  local pair c
  for pair in "postgres redis" "auth-service api-service" "analytics-service frontend"; do
    for c in $pair; do
      apply_component_once "lab-$c" sample "from-source/projects/latency-lab/components/$c.yaml"
      run_build latency-lab "lab-$c" 01   # no-op while the sample's own build-01 run exists
    done
    for c in $pair; do wait_build "lab-$c-build-01"; done
  done
  apply_component_once lab-api-service-broken sample from-source/projects/latency-lab/components/api-service-broken.yaml
  run_build latency-lab lab-api-service-broken 01
  wait_build lab-api-service-broken-build-01
}

phase_gcp() {
  log "gcp-microservice-demo (Online Boutique) in development"
  sample gcp-microservices-demo/gcp-microservice-demo-project.yaml | kc apply -f -
  wait_until "projectreleasebinding gcp-microservice-demo-development Ready" is_ready projectreleasebinding gcp-microservice-demo-development
  local c
  for c in ad checkout currency email frontend payment productcatalog recommendation shipping; do
    apply_component_once "$c" sample "gcp-microservices-demo/components/$c-component.yaml"
  done
  exists component cart || kc apply -f "$MANIFESTS/gcp-cart.yaml"
}

endpoint_host() {   # endpoint_host <releasebinding>
  jp releasebinding "$1" '{.status.endpoints[0].externalURLs.http.host}'
}

phase_traffic() {
  log "Background traffic (namespace demo-traffic) so runtime logs stay fresh"
  local existed=false
  kc get deployment traffic -n demo-traffic >/dev/null 2>&1 && existed=true
  sed -e "s/__SNIP_DEV_HOST__/$(endpoint_host snip-frontend-development)/" \
      -e "s/__SNIP_STAGING_HOST__/$(endpoint_host snip-frontend-staging)/" \
      -e "s/__SNIP_PROD_HOST__/$(endpoint_host snip-frontend-production)/" \
      -e "s/__BOUTIQUE_HOST__/$(endpoint_host frontend-development)/" \
      "$MANIFESTS/traffic.yaml" | kc apply -f -
  # pick up a changed script (the ConfigMap is only read at container start)
  [ "$existed" = true ] && kc rollout restart deployment/traffic -n demo-traffic >/dev/null
  return 0
}

phase_status() {
  log "What is deployed"
  kc get projects -n "$NS"
  kc get releasebindings -n "$NS" -o custom-columns='BINDING:.metadata.name,PROJECT:.spec.owner.projectName,RELEASE:.spec.releaseName,READY:.status.conditions[?(@.type=="Ready")].status'
  kc get workflowruns -n "$NS" -o custom-columns='RUN:.metadata.name,COMPONENT:.metadata.labels.openchoreo\.dev/component,SUCCEEDED:.status.conditions[?(@.type=="WorkflowSucceeded")].status'
}

phase_teardown() {
  log "Removing everything seed.sh created (keeps default/greeter-service, react-starter)"
  local p
  for p in url-shortener latency-lab gcp-microservice-demo grpc-demo; do
    kc delete projectreleasebinding -n "$NS" -l "openchoreo.dev/project=$p" --ignore-not-found --wait=false
    kc delete project "$p" -n "$NS" --ignore-not-found --wait=false
  done
  kc delete namespace demo-traffic --ignore-not-found --wait=false
  kc delete component github-issue-reporter demo-app -n "$NS" --ignore-not-found --wait=false
  kc delete workflowrun -n "$NS" greeting-service-build-01 greeting-service-build-02 --ignore-not-found
  kc delete resourcereleasebinding local-dev-postgres-development local-dev-config-bundle-development -n "$NS" --ignore-not-found
  kc delete resource local-dev-postgres local-dev-config-bundle -n "$NS" --ignore-not-found
  kc delete secretreference database-secret github-pat-secret -n "$NS" --ignore-not-found
  kc delete observabilityalertsnotificationchannel -n "$NS" --ignore-not-found \
    webhook-notification-channel-development webhook-notification-channel-staging webhook-notification-channel-production
  info "Not reverted automatically: build-fixes patches, ClusterComponentType service-with-configs,"
  info "ClusterResourceType config-bundle, demo-access.yaml. See README 'Teardown'."
}

ALL="access cleanup build-fixes url-shortener promote history scheduled-task configs local-dev gcp traffic greeter-builds latency-lab status"
[ "$#" -gt 0 ] || set -- $ALL
for phase in "$@"; do
  case "$phase" in
    access|cleanup|build-fixes|url-shortener|promote|history|scheduled-task|configs|local-dev|gcp|traffic|greeter-builds|latency-lab|status|teardown)
      "phase_$(echo "$phase" | tr '-' '_')" ;;
    *) die "unknown phase '$phase' (phases: $ALL teardown)" ;;
  esac
done

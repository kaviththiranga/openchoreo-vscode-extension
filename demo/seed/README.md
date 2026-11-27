# Demo cluster seed

Seeds the OpenChoreo cluster the extension footage is recorded against with believable data: the
advanced OpenChoreo samples at the cluster's version, promoted across environments, with release
history, real source builds (one failing on purpose) and live runtime logs.

- `seed.sh`: idempotent seeding script (bash 3.2-safe, so macOS `/bin/bash` works).
- `manifests/`: the few manifests the samples don't provide (see "What it creates").
- `demo-access.yaml`: gives the occ quick-start client the platform-engineer role.
- `workspaces-*.sh`: local workspace folders for each scene area. Separate from cluster seeding.

## Prerequisites

- An OpenChoreo **1.4.0-m.1** cluster (single-cluster k3d install) with the control, data and
  workflow planes, and `kubectl` pointing at it. Set `KUBE_CONTEXT` to pick a context.
- The **observability plane** with its log, tracing and metrics modules, so runtime logs work. On
  the VPS: `~/.claude/plugins/openchoreo-hardened-k3d/skills/openchoreo-hardened-k3d/assets/observability.sh up`.
- Network access to GitHub (sample manifests and build sources) and to the image registries
  (`cr.openchoreo.dev`, `us-central1-docker.pkg.dev`, Docker Hub).
- For phase `build-fixes`: `docker` access to the k3d node container (run it on the k3d host).
- Headroom: about 3 GB free RAM and 10 GB free disk. Online Boutique is about 250 MB, each
  concurrent build up to about 1 GB.

## Usage

```bash
./seed.sh                     # every phase, in order (~30 min, mostly the latency-lab builds)
./seed.sh url-shortener promote history     # selected phases
SAMPLES_DIR=~/git/openchoreo-at-tag ./seed.sh   # use a local checkout at the tag instead of GitHub
./seed.sh status              # what is deployed
./seed.sh teardown            # remove the demo data (see Teardown)
```

Samples are read from `raw.githubusercontent.com/openchoreo/openchoreo/v1.4.0-m.1/samples`, or from
`$SAMPLES_DIR/samples` (a checkout or `git archive` at that tag). Override the tag with `OC_TAG` only
for a cluster at that other version.

Re-running is safe. Components that already exist are left alone, so a re-run never resets a
workload, promotion or roll back that a scene made. Missing pieces are recreated. That includes
build runs a scene deleted (`greeting-service-build-01/02`, `lab-*-build-01`).

## What it creates

Everything goes in namespace `default`. The pipeline is development → staging → production.

| Phase | Creates | From |
|---|---|---|
| `access` | ClusterAuthzRoleBinding: `openchoreo-cli-quickstart` → `platform-engineer` | `demo-access.yaml` |
| `cleanup` | deletes the stray `test` component | n/a |
| `build-fixes` | runtime patches so source builds work on this host (see Builds) | n/a |
| `url-shortener` | project `url-shortener`: `snip-frontend`, `snip-api-service`, `snip-analytics-service`, `snip-redis` and the Resource `snip-postgres`, in development. Also creates the alert notification channels for all three environments. | `samples/from-image/url-shortener`, `manifests/alert-channels.yaml` |
| `promote` | the same project in staging and production (ReleaseBindings, ResourceReleaseBindings) | n/a |
| `history` | a second release of `snip-api-service` and `snip-frontend` (one env var each). Development and staging run it, production stays on the first release. | n/a |
| `scheduled-task` | `github-issue-reporter` (cronjob, every 5 min in development) in project `default` | `samples/from-image/issue-reporter-schedule-task` |
| `configs` | `demo-app` (env vars, config files, two SecretReferences backed by OpenBao). Also adds the ClusterComponentType `service-with-configs`. | `samples/component-types/component-with-configs` |
| `local-dev` | Resources `local-dev-postgres` and `local-dev-config-bundle` (development), project `grpc-demo` with `grpc-greeter`. Also adds the ClusterResourceType `config-bundle`. | `samples/local-development` |
| `gcp` | project `gcp-microservice-demo` (Online Boutique, 10 services and `redis-cart`), development only | `samples/gcp-microservices-demo`, `manifests/gcp-cart.yaml` |
| `traffic` | namespace `demo-traffic` with a small curl loop, so runtime logs always have fresh lines. It also creates a few short links in each URL Shortener environment. | `manifests/traffic.yaml` |
| `greeter-builds` | `greeting-service-build-01` (succeeds, Go, about 3 to 5 min), then `greeting-service-build-02`, which fails on purpose: its Dockerfile path does not exist (the `samples/mcp/build-failures` scenario) | `samples/from-source/services/go-docker-greeter` |
| `latency-lab` | project `latency-lab`: six source-built `lab-*` components, built two at a time, plus `lab-api-service-broken`, whose build fails at `go build` | `samples/from-source/projects/latency-lab`, `manifests/latency-lab-alert.yaml` |

Kept as they were: `default/greeter-service`, `greeting-service` and `react-starter`, namespace
`gitops-demo` (managed by Flux).

Deviations from the samples:

- **No HTTP greeter provider from `samples/local-development`.** It creates project `greeter` with a
  component named `greeter-service`, which collides with `default/greeter-service`. Component names
  are unique per namespace.
- **Online Boutique Redis.** The sample's `redis` Resource (ClusterResourceType `valkey`) never
  becomes ready on this cluster, because its external-secrets Password generator reports no status.
  `manifests/gcp-cart.yaml` runs a plain `redis-cart` component instead. Cart reaches it through an
  endpoint dependency.
- **Alert-rule components** (`snip-frontend`, `lab-frontend`) need an
  `ObservabilityAlertsNotificationChannel` in every environment they run in. Their ReleaseBinding
  must also name it under `traitEnvironmentConfigs.<alert>.actions.notifications.channels`. The
  seed creates the channels and pre-creates the bindings.

## Builds: runtime fixes on the VPS host

The cluster is k3d on kernel 5.15, behind the host's UFW and DOCKER-USER firewall. Out of the box,
every source build fails. `build-fixes` applies three patches:

1. **User namespaces off for build pods.** The build and publish ClusterWorkflowTemplates
   (`containerfile-build`, `publish-image`, and the buildpack ones) set `podSpecPatch:
   {"hostUsers": false}`. On kernel 5.15 that pod cannot mount its projected service-account token
   (idmapped tmpfs needs 6.3+). The phase patches them to `{"hostUsers": true}`. The build
   namespace is already privileged. With user namespaces off, no containerd `slow_chown` and no
   node restart are needed.
2. **Registry push from build pods.** `publish-image` pushes to `host.k3d.internal:10082`, which
   pods cannot reach: the host firewall drops it, while `:8080` (API, Thunder) is allowed. The
   phase adds a `hostAliases` entry to the `publish-image` pod only, mapping `host.k3d.internal` to
   the `registry` Service ClusterIP in `openchoreo-workflow-plane`. In-cluster DNS stays unchanged:
   `*.openchoreo.localhost` still rewrites to `host.k3d.internal`, which other services need.
3. **Image pull on the node.** The node's containerd pulls `host.k3d.internal:10082/...` for built
   workloads. The phase points `host.k3d.internal` in the node's `/etc/hosts` at the same ClusterIP.
   **This does not survive a node restart**, so re-run `./seed.sh build-fixes` after one.

The phase also raises `dockerfile-builder`'s `ttlAfterCompletion` from `1d` to `30d`, and patches
existing runs, so build history and the failed builds outlive the recording window.

## Observability

The observability plane was stopped on 2026-11-19 to save resources, which left dangling
references. `observability.sh up` reinstalled it at the pinned chart versions and re-registered
`ClusterObservabilityPlane default`. The `ClusterDataPlane` and `ClusterWorkflowPlane`
`observabilityPlaneRef`s resolve again.

Chain the extension follows: Environment → `ClusterDataPlane default` → `ClusterObservabilityPlane
default` → `observerURL http://observer.openchoreo.localhost:11080`. `GET /api/v1alpha1/metadata`
advertises the same observer. Check runtime logs with an observer query, as the extension's View
Runtime Logs does:

```bash
curl -s -X POST http://observer.openchoreo.localhost:11080/api/v1/logs/query \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startTime":"<15 min ago, RFC3339>","endTime":"<now>","limit":20,"sortOrder":"desc",
       "searchScope":{"namespace":"default","project":"url-shortener","component":"snip-api-service","environment":"development"}}'
```

Recording from a Mac through an SSH tunnel? Forward port 11080 (observer) as well as 8080
(API, Thunder).

## Teardown

```bash
./seed.sh teardown
```

This deletes projects `url-shortener`, `latency-lab`, `gcp-microservice-demo` and `grpc-demo`,
along with their ProjectReleaseBindings. It also deletes `github-issue-reporter`, `demo-app`, the
`local-dev-*` Resources, the greeting-service build runs, the SecretReferences, the alert channels
and namespace `demo-traffic`. To restore the cluster-level changes as well:

```bash
# build fixes
for t in containerfile-build publish-image ballerina-buildpack-build gcp-buildpacks-build paketo-buildpacks-build; do
  kubectl patch clusterworkflowtemplate $t --type=json \
    -p '[{"op":"replace","path":"/spec/templates/0/podSpecPatch","value":"{\"hostUsers\": false}"}]'
done
kubectl patch clusterworkflow dockerfile-builder --type=merge -p '{"spec":{"ttlAfterCompletion":"1d"}}'
docker exec k3d-openchoreo-server-0 sh -c \
  "grep -v host.k3d.internal /etc/hosts > /tmp/h; echo '$(docker network inspect k3d-openchoreo -f '{{(index .IPAM.Config 0).Gateway}}') host.k3d.internal' >> /tmp/h; cat /tmp/h > /etc/hosts"
# cluster-scoped types added by samples
kubectl delete clustercomponenttype service-with-configs
kubectl delete clusterresourcetype config-bundle
# demo write access
kubectl delete -f demo-access.yaml
# observability plane (optional; it was off before the demo)
~/.claude/plugins/openchoreo-hardened-k3d/skills/openchoreo-hardened-k3d/assets/observability.sh down
```

`greeting-service` keeps the ComponentRelease and deployment from its first build. Delete its
`greeting-service-development` ReleaseBinding to undeploy it.

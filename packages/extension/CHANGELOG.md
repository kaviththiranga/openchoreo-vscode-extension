# Changelog

## Unreleased

- Depend on `@openchoreo/openchoreo-client-node` from public npm (^1.3.3) instead of a local checkout, so the extension builds anywhere
- Bump the managed `occ` CLI to v1.3.3; Windows now gets the "install manually" path (OpenChoreo publishes no Windows `occ` asset)
- Read the control plane's version from `/version`; show server and CLI versions in the status bar tooltip
- Scaffolded Workloads use the endpoint `protocol` field on OpenChoreo 1.4+ servers (`type` before)
- Language server recognises every OpenChoreo 1.3 kind (plus the 1.4 additions) and drops removed legacy kinds (Organization, Release, API, APIBinding, APIClass, ConfigurationGroup)
- CI workflow (build, lint, test, package) and unit tests for the extension package
- One kind registry (`src/kinds/registry.ts`, generated from the OpenChoreo 1.3.3 API spec) now drives API routes, delete permissions, editability and the language-server feed; routes are type-checked against the client
- Editing and saving ProjectType, ClusterProjectType, ProjectReleaseBinding and alert notification channel YAML now works
- Fix role nodes mapping to non-existent kinds (`NamespaceRole`, `ClusterRole`, …) instead of `AuthzRole` / `ClusterAuthzRole`
- CRD schemas are generated from the OpenChoreo v1.3.3 CRDs (`scripts/generate-schemas.mjs`): all 37 kinds covered (was 17); unknown fields the API server would prune are flagged; zero false warnings across the official v1.3.3 samples
- Completions for Project `spec.parameters` (from its ProjectType) and Resource `spec.parameters` (from its ResourceType); trait parameters now come from the trait under the cursor
- References accept cluster-scoped targets (ClusterComponentType, ClusterDataPlane, …) and are only checked when every target kind could be listed, so missing permissions no longer cause false "not found" warnings
- CEL variable checks apply only to ComponentType/Trait templates
- **Run Locally Against Environment** (`occ remote`, OpenChoreo 1.3+): from a `workload.yaml` or `.openchoreo/` folder, open a shell wired to an environment's real dependencies, or keep tunnels open and print the environment for a debugger
- **Open Shell** (`occ component exec`, 1.3+) and **View Runtime Logs** (observer logs query, last 15 min–24 h with an optional text filter) on components and their environments
- **Run Now** for scheduled-task (cronjob) components from a release binding (1.3+)
- Project Types and Cluster Project Types in the platform trees, Project Bindings under each project, and create templates for both type kinds (1.3)
- New Project scaffolds include the `spec.type` reference that OpenChoreo 1.3 requires

## 0.1.1 — 2026-05-18

- Support OpenChoreo clusters with authentication disabled — extension probes the control plane's RFC 9728 metadata and connects without a Bearer token when auth is off
- Auto-download `occ` CLI on first run with consent, into extension global storage, with SHA-256 verification
- Add `openchoreo.downloadCli` command and an `openchoreo.cliPath` setting for custom binary paths
- Show an "auth disabled" badge in the sidebar header and suffix the status bar with an unlock icon on auth-disabled clusters
- Stop reporting "Session expired" in the status bar when no token is required
- Include component context in "Add to Chat" / "Add YAML to Chat" prefixes for resources nested under a component (Workload, WorkflowRun, ReleaseBinding, ComponentRelease)
- Fix MCP tool list being empty on auth-disabled clusters (append `?filterByAuthz=false` and omit the Authorization header)
- Prewarm the security-disabled probe at activation so the MCP server registers on first query
- Prompt the user once to start the MCP server from the command palette (VS Code requires manual start on first registration)

## 0.1.0 — 2026-05-18

Initial unofficial release.

- Sidebar resource explorer: Projects, Namespace Resources, Cluster Resources
- `occ` CLI login flow, context/namespace switching, logout
- Scaffold OpenChoreo manifests from a source project (Node, Go, JVM, Python, Dockerfile)
- "Add to Chat" and "Add YAML to Chat" for any tree node
- Generate release, trigger build, deploy to environment
- MCP server registration for Copilot Chat
- CRD editing with intelligent completions via the bundled language server

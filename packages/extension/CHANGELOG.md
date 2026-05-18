# Changelog

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

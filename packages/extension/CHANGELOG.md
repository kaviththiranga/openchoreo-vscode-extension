# Changelog

## Unreleased

- **occ language server**: when the installed occ has `occ lsp`, the extension runs it for Go to Definition across local and cluster resources, CEL and reference suggestions, and pre/post-render validation (by @RukshanRanasinghe2000). Otherwise it uses the bundled server as before. New setting `openchoreo.languageServer` (`auto`, `occ`, `bundled`)
- **Linked components**: the status bar shows the components built from the open folder, matched by git remote and app path through the workflow's repository parameter markers, with actions to build, view logs, open a shell, run locally and open the repository
- **Clone Source** on a component, **Build This Commit** for a linked folder, and after a push, the auto-build for the pushed commit followed in the status bar (`openchoreo.builds.followAfterPush`)
- **Compare Releases…** and **Roll Back…** on releases and deployed environments
- **Debug Against Environment**: launch configurations with an `openchoreo` attribute open `occ remote` tunnels in the background and get the dependency bindings in their `env`; open tunnels show in the status bar (`openchoreo.localDev.keepTunnelsOpen`)
- Run Locally and Debug Against Environment ask for the environment name when your role can't list environments
- **Compare with Cluster** for OpenChoreo YAML files and **Compare with Repository** for sidebar resources, diffing desired state without status or server-set metadata
- Resources managed by Flux or Argo CD are badged in the sidebar; saving, applying, promoting, deploying or deleting them through the API asks first and offers **Change in Repository**, which edits the GitOps repository instead. New settings `openchoreo.gitops.mode` and `openchoreo.gitops.allowDirectChanges`
- **OpenChoreo GitOps view** with each declared resource's sync state and cluster-only resources; **Generate Releases in Repository…** and **Promote in Repository…** run occ in file-system mode and offer a branch, commit and pull request
- **Go to Definition** for references between OpenChoreo resources (to the repository file, or the resource on the cluster); reference validation accepts resources declared in the repository
- The extension now activates once VS Code has started, so linked components and the GitOps view appear without opening a YAML file first
- Fix: the GitOps view and **Compare with Cluster** showed differences for zero values the API leaves out, such as `isProduction: false`, and for server defaults like `gateway: {}`
- **Change in Repository** saves the repository file (unless it already had unsaved edits) and completes the save without a "Failed to save" error; the sidebar copy shows the cluster again
- Fix: Components naming their type as `deployment/service` got a "not found" warning from the bundled language server
- Commit and push errors from **Promote in Repository** and **Generate Releases** show git's own message
- Fix: client-credentials logins (service accounts) showed "Session expired" once the token lapsed; the extension now mints a new token like occ does
- Fix: with `openchoreo.configPath` set to another `.openchoreo/config`, the occ commands the extension runs now use that login
- Fix: on OpenChoreo 1.4, workflow runs showed no status icon or phase (1.4 reports them as conditions), and failed runs had no **Troubleshoot with Copilot**
- Fix: lists stopped at the API's first page of 20 items, so larger namespaces had missing tree items and completions and false "not found" warnings
- Fix: the **Create Component** scaffold and **Scaffold Component from this Project** wrote component types and workflows the API rejects; they now reference a `ClusterComponentType` as `<workloadType>/<name>` (e.g. `deployment/service`) and a `ClusterWorkflow`, with the repository taken from the folder's git remote
- Component type completions, reference checks and Go to Definition use the `<workloadType>/<name>` form
- Scaffold previews open as `component.yaml` and `workload.yaml`, Save writes them and opens the files, and **Commit** works (it always failed before)
- The sidebar refreshes after saves, Generate Release, **Refresh Resources** and `openchoreo.autoRefresh` (these did nothing before), and refreshing keeps expanded nodes open instead of collapsing the tree
- The bundled language server handles multi-document YAML (validation, completions, hover and CEL per document, one outline entry per document), completes keys inside nested objects and list items (including `kind`), completes ComponentType parameters, shows object defaults properly, lists schema fields before CEL methods, and shows hover docs for keys in list items
- Fix: completions for objects and arrays were indented twice
- Workflow run logs are shown in time order (1.4 returned them grouped by step, so lines repeated or went missing)
- Pickers opened from the sidebar no longer close when focus returns to it; Promote, Deploy and Roll Back drafts are clean YAML without status and server fields
- **Compare Releases…** puts the older release on the left; **Run Now** shows only on scheduled tasks; sidebar labels keep their space before descriptions
- Chat hand-offs (Add to Chat, Add YAML to Chat, Troubleshoot, Fix and Summarize with Copilot) are hidden when `chat.disableAIFeatures` is on
- The GitOps view rescans when it first shows, so files created right after startup appear, and deleting a folder removes its rows; **Compare with Repository** shows once in the menu
- Workflow runs the extension starts get short names (`<component>-<8 characters>`)
- Removed an unused snippets file from the package
- Run Locally and Open Shell terminals run `occ` by name when its folder is on the terminal `PATH`, and Reveal App Folder and Clone Source show workspace-relative paths, folder names or `~` paths instead of absolute ones
- Fix: with an expired stored token, simultaneous requests at startup could each try to refresh it, and one failed refresh left the sidebar and status bar on "Session expired"; refreshes are now shared and retried once

## 0.3.0 — 2026-11-18

AI release; also includes the 0.2.1 rename to **OpenChoreo for VS Code**.

- MCP servers renamed to match the OpenChoreo skills: `openchoreo-cp` (developer toolsets) and opt-in `openchoreo-pe` (platform-engineer toolset), so neither goes over the 128-tool chat limit. Choose toolsets with `openchoreo.mcp.toolsets`; turn on `openchoreo.mcp.platformEngineerTools` for the platform-engineer tools that were previously offered by default
- Register the observer (`openchoreo-obs`) and SRE agent (`openchoreo-sre`) MCP servers, discovered from the namespace's environments or the platform metadata; override with `openchoreo.mcp.observerUrl` / `openchoreo.mcp.sreAgentUrl`
- Ship the official OpenChoreo agent skills (github.com/openchoreo/skills, mirrored at a pinned commit), **OpenChoreo Developer** and **OpenChoreo Platform Engineer** custom agents, and instructions for OpenChoreo resource YAML
- Add the extension-managed occ binary to the integrated terminal's `PATH`
- Chat tools for agents: **Validate OpenChoreo YAML** (`#openchoreoValidate`), **Get OpenChoreo Context** (`#openchoreoContext`) and **Scaffold OpenChoreo Resource** (`#openchoreoScaffold`)
- **Troubleshoot with Copilot** on failed workflow runs and deployments, a **Fix with Copilot** quick fix for OpenChoreo validation problems, and **Summarize with Copilot** for runtime logs; **Add YAML to Chat** now attaches the resource instead of pasting it
- Register the MCP servers in Cursor through its MCP API, and add **OpenChoreo: Use with Other AI Agents…** with setup commands for Claude Code and the skills
- Fix: the occ CLI was reported missing when `occ version` took over 3 seconds (it also asks the server for its version)

## 0.2.1 — 2026-11-17

- Rename to **OpenChoreo for VS Code** with the standard OpenChoreo icon; the extension ID (`KavithLokuhewage.openchoreo-unofficial`) is unchanged, so existing installs keep updating
- Drop the first-run disclaimer popup; the README notes the extension is community-maintained

## 0.2.0 — 2026-11-16

Targets OpenChoreo 1.3 (works with 1.4 milestones).

- Depend on `@openchoreo/openchoreo-client-node` from public npm (^1.3.3) instead of a local checkout, so the extension builds anywhere
- Bump the managed `occ` CLI to v1.3.3; Windows now gets the "install manually" path (OpenChoreo publishes no Windows `occ` asset)
- Read the control plane's version from `/version`; show server and CLI versions in the status bar tooltip
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
- Fix hover showing nothing for a key that follows a sibling with nested fields (e.g. `deploymentPipelineRef` after `type:`)
- End-to-end tests in a real VS Code instance (`pnpm test:e2e`), run in CI and before every release; tagged releases build, test and publish automatically

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

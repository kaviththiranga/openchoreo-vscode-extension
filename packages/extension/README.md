# OpenChoreo for VS Code

Community-maintained by Kavith Lokuhewage, an OpenChoreo contributor. Learn about OpenChoreo at <https://openchoreo.dev>.

IDE-native tooling for the [OpenChoreo](https://openchoreo.dev) developer platform — resource management, CRD editing with intelligent completions, and AI-powered workflows via MCP.

## Prerequisites

- **VSCode** 1.85+ (1.99+ recommended for MCP/Copilot features)
- **occ CLI** logged in — the extension reads authentication from the occ CLI config. If `occ` isn't installed, the extension offers to download a verified copy (v1.3.3) on first run (macOS and Linux; on Windows, install it manually)
- **OpenChoreo 1.3** recommended. Core features work against 1.1 and 1.2; features marked *1.3+* need a 1.3 control plane, and 1.4 milestone clusters are supported (see [OpenChoreo version support](#openchoreo-version-support))

### Getting Started

1. Install the [occ CLI](https://openchoreo.dev/docs/getting-started/install-cli)
2. Log in to your OpenChoreo cluster:
   ```bash
   occ login
   ```
3. Install this extension
4. The OpenChoreo icon appears in the activity bar — click to open

The extension automatically detects your occ CLI session and connects to the configured control plane.

## Authentication & Security

The extension integrates directly with the **occ CLI** for authentication — it does not implement its own login flow or store tokens separately.

### How It Works

1. **Login** — handled entirely by the occ CLI (`occ login`). The CLI performs a PKCE/browser-based OAuth flow and writes tokens to `~/.openchoreo/config`
2. **Token reading** — the extension reads JWT access tokens and refresh tokens directly from the occ CLI config file. No separate token storage.
3. **Token refresh** — when the access token expires (checked via the JWT `exp` claim with a 60-second buffer), the extension automatically refreshes it:
   - Fetches OAuth metadata from `{controlPlaneUrl}/.well-known/oauth-protected-resource` (RFC 9728)
   - Discovers the token endpoint via `{authServer}/.well-known/openid-configuration` (RFC 8414)
   - Exchanges the refresh token for a new access token
   - **Writes the new tokens back to `~/.openchoreo/config`** — keeping CLI and extension in sync
4. **Periodic refresh** — a background timer checks token freshness every 4 minutes to ensure tokens stay valid for MCP and API calls
5. **Config file watching** — the extension polls `~/.openchoreo/config` every 5 seconds for changes. When the CLI updates tokens (e.g., after `occ login`), the extension auto-detects the change

### Shared Token State

The extension and occ CLI share the same config file (`~/.openchoreo/config`). This means:

- Both always agree on the current token, namespace, and context
- Switching namespace in the extension updates the CLI config (and vice versa)
- Token refreshes by either the extension or CLI are visible to both
- The config file uses `0600` permissions (owner read-write only)

### MCP Authentication

Every OpenChoreo MCP server the extension registers receives the current Bearer token via HTTP headers. The token is refreshed automatically via the periodic refresh timer and session change events — ensuring MCP requests always use a valid token.

For clusters installed with **authentication disabled**, the extension registers the servers without an `Authorization` header and adds `?filterByAuthz=false` to control-plane URLs so the platform's per-user tool filter doesn't hide the catalog. The OpenChoreo control plane still enforces its own authorization independently.

### Enabling the MCP Servers in Copilot Chat

VS Code does **not** auto-start newly-registered MCP servers — this is a security feature of the MCP API, not something the extension can override. After the OpenChoreo extension activates:

1. Open the Command Palette → **MCP: List Servers**.
2. Find **openchoreo-cp** (and **openchoreo-obs**, **openchoreo-sre**, **openchoreo-pe** if registered) in the list.
3. Click **Start** (you only need to do this once per machine).
4. Open Copilot Chat → tools picker — the OpenChoreo tools are now available.

If the servers don't appear in the list at all, check that you are logged in via `occ login` and that the OpenChoreo Output panel shows a line like `MCP servers providing: openchoreo-cp=<url>`.

### Security Notes

- Tokens are stored in **plain text** in the occ CLI config file (same model as kubectl/kubeconfig)
- The extension does not implement its own OAuth flow — it delegates to the occ CLI
- No tokens are stored in VSCode settings, extension storage, or keychain
- All API communication uses the control plane URL from the occ CLI config

## Features

### Sidebar Explorer

A unified webview sidebar replaces the traditional tree views, providing a richer experience:

**Context Header** — shows the current context and namespace as clickable chips with custom icons. Click to switch context or select a namespace.

**Projects** — Projects, Components, Deployment Pipelines, Workflow Runs, Releases, Release Bindings, Workloads, Resources (with their releases and bindings) and, on 1.3+, Project Bindings (each project's per-environment deployment of its project type)

**Namespace Resources** — Environments, Data Planes, Workflow Planes, Observability Planes, Component Types, Resource Types, Project Types (1.3+), Workflows, Traits, Secret References, RBAC Roles & Bindings

**Cluster Resources** — Cluster-scoped variants of infrastructure resources (including Cluster Resource Types and Cluster Project Types) and Cluster RBAC. Kinds the connected control plane doesn't serve yet show a "Requires OpenChoreo 1.3+" hint instead of an empty list

Each section has a title bar with **create (+)**, **refresh**, and **collapse all** buttons.

**Selection & Keyboard Navigation** — click to select and activate a node. Use arrow keys to navigate (Up/Down to move, Left/Right to collapse/expand, Enter to open, Space to toggle). Selection persists across view switches.

**Indent Guides** — vertical guide lines appear on hover at each depth level, with the selected node's guide rendered at full opacity for clarity.

**Progress Indicators** — section-level loading shows a native-style horizontal progress bar under the section header.

**Custom Icons** — resource types use Backstage Material UI icons via a custom WOFF2 icon font (`openchoreo-icons`), ensuring consistent visuals between the VS Code extension and the Backstage portal. Icons inherit the theme foreground color automatically.

Resources with a `deletionTimestamp` (being deleted) are shown with a `(deleting)` label and opened as read-only.

### Resource Editing

Click any resource in the tree to open it as a YAML file. The extension uses a virtual filesystem (`openchoreo://`) that maps directly to the OpenChoreo API:

- **Open** — fetches the resource via GET and displays as clean YAML
- **Edit** — make changes in the editor, file becomes dirty (dot in tab)
- **Save (Cmd+S)** — pushes changes to the cluster via PUT with optimistic concurrency
- **Conflict detection** — if the resource was modified on the cluster since you opened it (409 Conflict), you're prompted to reopen with the latest version
- **Read-only resources** — Workflow Runs, Component Releases and Project Releases open as read-only (run history and immutable snapshots)

### Resource Creation

Click the **+** button on a tree category or project to create a new resource from a scaffold template:

- The scaffold opens as a dirty virtual file pre-filled with namespace and project context
- Edit the template, then **Cmd+S** to create the resource on the cluster (uses POST)
- After successful creation, the tab reopens pointing to the actual resource

Available scaffolds: Project, Component, ComponentType, ProjectType, Trait, Environment, DataPlane, WorkflowPlane, ObservabilityPlane, Workflow, Workload, DeploymentPipeline, SecretReference, AuthzRole, AuthzRoleBinding, ClusterComponentType, ClusterProjectType, ClusterWorkflow, ClusterTrait, ClusterDataPlane, ClusterWorkflowPlane, ClusterObservabilityPlane, ClusterAuthzRole, ClusterAuthzRoleBinding

The Project scaffold includes the `spec.type` project type reference that OpenChoreo 1.3 requires (`ClusterProjectType` `default`), and leaves it out for older control planes.

### Scaffold from Your Source Code

**OpenChoreo: Scaffold Component from this Project** inspects the open folder (Node, Go, JVM, Python, Dockerfile), proposes a Component and Workload, previews both, and writes them to `.openchoreo/component.yaml` and `.openchoreo/workload.yaml`.

### Create Namespace

The namespace selector includes a **"Create New Namespace..."** option at the bottom. Enter a name, and it creates the namespace via the API and switches to it automatically.

### Create Context

The context switcher includes a **"Create New Context..."** option. Enter a context name and control plane URL, then authenticate via `occ login` in a terminal that opens automatically.

### Workflow Run Observability

Expand any Workflow Run in the tree to see its step-by-step execution status:

- **Colored status icons** — green check (Succeeded), red X (Failed), spinning sync (Running), clock (Pending), skip (Skipped), warning (Error)
- **Step timing** — each step shows its phase and duration (e.g., `Succeeded (2m30s)`)
- **View Logs** — right-click a Workflow Run → "View Logs" to stream all logs into an Output channel. Logs auto-refresh every 3 seconds while the channel is open
- **View Events** — right-click a Workflow Run → "View Events" to see all Kubernetes events with auto-refresh
- **View Step Logs** — right-click an individual step → "View Step Logs" to stream logs for that specific step only
- **View Step Events** — right-click an individual step → "View Step Events" to see events for that step only
- **Empty state feedback** — if no logs/events are available yet, a message is shown immediately (e.g., "No logs available yet") instead of a blank channel
- **Auto-stop** — streaming stops automatically after ~30s of no new data or ~9s of consecutive fetch errors

Enable `openchoreo.autoRefresh` in settings to automatically poll running workflow run status.

### Deployed Resource Tree

Expand any Release Binding in the tree to see the Kubernetes resources deployed by that release:

- **Hierarchical view** — shows the full resource hierarchy (e.g., Deployment → ReplicaSet → Pod)
- **Health indicators** — colored icons for Healthy (green), Degraded (yellow), Progressing (blue), Missing (red)
- **View Definition** — click any K8s resource to view its full YAML definition (read-only)
- **Pod Logs** — right-click a Pod → "View Pod Logs" to stream container output with auto-refresh
- **Resource Events** — right-click any deployed resource → "View Events" to see Kubernetes events with auto-refresh

### Inner Loop (OpenChoreo 1.3+)

Work against a real environment without leaving the editor:

- **Run Locally Against Environment** — right-click a `workload.yaml` (or a `.openchoreo` folder) in the Explorer, or run it from the Command Palette. Pick an environment, then either open a shell whose environment variables point at local tunnels to that environment's real dependencies (run your app from it), or keep the tunnels open and print the resolved variables to copy into a debugger launch configuration. Uses `occ remote`; dependency secrets stay in the session and are never printed unless you ask
- **Open Shell** — right-click a Component or one of its deployed environments → an interactive shell in a running pod (`occ component exec`)
- **View Runtime Logs** — right-click a Component or one of its environments → choose a window (15 minutes to 24 hours) and an optional text filter; logs are read from the environment's observability plane and shown in an Output channel with pod and level. Works wherever the environment's data plane has an observability plane with an observer
- **Run Now** — right-click a deployed environment of a scheduled-task (cronjob) component to start a one-off Job from its schedule

### Generate Release

Right-click a Component → "Generate Release" to create an immutable release snapshot from the current component state (ComponentType + Traits + Workload configuration). Optionally provide a release name or let the server auto-generate one.

### Trigger Build

Right-click a Component to trigger its configured workflow:

- **Trigger Build** — immediately creates a Workflow Run using the component's configured workflow and parameters. No picker needed.
- **Trigger Build with Parameters** — opens a pre-filled WorkflowRun YAML editor with the component's workflow configuration. Edit parameters, then Cmd+S to create the run.

### Run Generic Workflows

Workflows and ClusterWorkflows in Namespace/Cluster Resources can be triggered directly:

- **Run Workflow** — right-click any Workflow or ClusterWorkflow → opens a WorkflowRun YAML editor pre-filled with that workflow reference. Fill in parameters and Cmd+S to create.
- Namespace-scoped workflows show their runs as expandable children (with step status and timing).

### Deployment Pipeline

The Release Bindings section under each component shows the full deployment pipeline:

- **Pipeline visualization** — all environments from the project's DeploymentPipeline are shown in topological order
- **Active bindings** — environments with deployed releases show the release name, are expandable to show K8s resources, and have a "Promote" action
- **Inactive environments** — environments without a deployment show as "(not deployed)" with a "Deploy Release..." action
- **Promote** — right-click an active binding to promote its release to the next environment(s) in the pipeline. Opens a ReleaseBinding YAML with the release pre-filled for the target environment.
- **Deploy to Environment** — right-click a ComponentRelease to deploy it to a chosen environment from the pipeline
- **Deploy Release** — right-click an inactive environment to pick a release and create a new ReleaseBinding

### Intelligent Completions

The built-in language server provides context-aware completions across multiple dimensions:

#### Schema-Based Completions

- **Property keys** — offers fields from the CRD schema with smart snippets (objects expand with indentation, booleans offer `true`/`false`, enums offer allowed values)
- **Value completions** — enum values, const values, boolean literals, defaults
- **Already-defined filtering** — properties already present at the current level are excluded from suggestions

#### Dynamic Resource References

Fields that reference other resources (marked with `x-openchoreo-ref` in schemas) offer names from the cluster:

| Field | Offers |
|---|---|
| `metadata.namespace` | Accessible namespaces |
| `spec.componentType.name` | ComponentTypes + ClusterComponentTypes |
| `spec.type.name` (Project, 1.3+) | ProjectTypes + ClusterProjectTypes |
| `spec.type.name` (Resource) | ResourceTypes + ClusterResourceTypes |
| `spec.workflow.name` | Workflows + ClusterWorkflows |
| `spec.traits[].name` | Traits + ClusterTraits |
| `spec.owner.projectName` | Projects |
| `spec.dataPlaneRef.name` | DataPlanes + ClusterDataPlanes |
| `spec.observabilityPlaneRef.name` | ObservabilityPlanes + ClusterObservabilityPlanes |
| `spec.deploymentPipelineRef.name` | DeploymentPipelines |
| `spec.environment` | Environments |
| `spec.workflowPlaneRef.name` | WorkflowPlanes + ClusterWorkflowPlanes |

The full list lives in [`schemas/refs.json`](../../schemas/refs.json).

#### Cross-Document Schema Completions

When editing a **Component**, `spec.parameters` offers property completions from the referenced ComponentType's `openAPIV3Schema` — including types, defaults, and enum values. **Project** `spec.parameters` (1.3+) does the same from its ProjectType, and **Resource** `spec.parameters` from its ResourceType.

Component `spec.traits[].parameters` offers the parameters of the trait entry you're editing (falling back to all traits while its `name` is still empty), and **ReleaseBinding** `componentTypeEnvironmentConfigs` offers properties from component type environment config schemas.

#### CEL Expression Completions

Inside `${...}` expressions (used in ComponentType and Trait templates), the extension offers:

**Context variables** with dot-completion:
- `metadata.` → `componentName`, `projectName`, `environmentName`, `name`, `namespace`, `labels`, `podSelectors`, ...
- `parameters.` → dynamic fields from the document's `openAPIV3Schema`
- `environmentConfigs.` → dynamic fields from the document's `openAPIV3Schema`
- `workload.` → `container.image`, `container.command`, `container.args`, `endpoints`
- `configurations.` → `configs.envs`, `configs.files`, `secrets.envs`, `secrets.files`
- `dependencies.` → `items`, `envVars`
- `dataplane.` → `secretStore`, `gateway`
- `gateway.` → `ingress.external`, `ingress.internal`
- `trait.` → `name`, `instanceName` (Trait context only)

**OpenChoreo functions**: `oc_omit()`, `oc_merge()`, `oc_generate_name()`, `oc_dns_label()`, `oc_hash()`

**Configuration helpers**: `configurations.toContainerEnvFrom()`, `configurations.toVolumes()`, `configurations.toContainerVolumeMounts()`, `workload.toServicePorts()`, `dependencies.toContainerEnvs()`

**CEL builtins**: `has()`, `size()`, `math.greatest()`, `base64.encode()`, and all list/map methods (`.map()`, `.filter()`, `.exists()`, `.all()`, `.flatten()`, `.sort()`, `.join()`, `.transformList()`, `.transformMap()`, etc.)

#### Bootstrap Completions

- **Empty files** — scaffold templates (`oc-project`, `oc-component`, etc.)
- **New files** — `apiVersion` and `kind` field suggestions to get started
- **`kind:` field** — all 43 OpenChoreo CRD kinds (1.3, plus the 1.4 additions)
- **`apiVersion:` field** — `openchoreo.dev/v1alpha1`

### Schema Validation

Real-time diagnostics as you type, against JSON Schemas generated from the OpenChoreo v1.3.3 CRDs for all 37 kinds:

- **Type checking** — detects mismatches (string where integer expected, etc.)
- **Required fields** — errors for missing required properties
- **Unknown properties** — warnings for fields the CRD doesn't define. The API server silently drops such fields, so this catches typos like `enviroment:` before they vanish; free-form fields (parameters, templates) are left open
- **Const validation** — errors when a field doesn't match its required value
- **Enum validation** — errors for values not in the allowed set
- **String constraints** — warnings for `minLength`, `maxLength`, `pattern` violations
- **Number constraints** — warnings for `minimum`/`maximum` violations
- **Array validation** — validates items against the items schema, checks `minItems`/`maxItems`

### CEL Expression Validation

Inside `${...}` expressions:

- **Unclosed expressions** — error for missing closing `}`
- **Empty expressions** — warning for `${}`
- **Unknown variables** — warning when the first identifier isn't a known context variable (ComponentType and Trait templates only — other kinds, such as alert notification channels, template with their own variables)
- **Type skip** — CEL expressions correctly skip type validation (dynamic values are validated at render time, not edit time)

### Cross-Resource Reference Validation

Fields referencing other resources show **warnings** if the referenced resource doesn't exist in the current namespace. Supports merged references (e.g., `ComponentType+ClusterComponentType` — checks both). A reference is only checked when every kind it may point to could be listed, so missing permissions (e.g. no access to cluster-scoped resources) never produce false warnings.

### Hover Documentation

Hover over any YAML key to see:

- Field type and description from the schema
- Constraints (minLength, maxLength, pattern, minimum, maximum)
- Default value
- Allowed enum values

### Document Symbols

The Outline view (Cmd+Shift+O) shows the hierarchical structure of OpenChoreo YAML files:

- Maps shown as objects with children
- Arrays show item count and named items (by `name`, `id`, or `instanceName`)
- Scalar values show their value as detail text
- Enables breadcrumb navigation in the editor

### Common Labels & Annotations

Inside `metadata.labels:` and `metadata.annotations:`, the extension suggests common OpenChoreo keys:

**Labels**: `openchoreo.dev/project`, `openchoreo.dev/component`, `openchoreo.dev/environment`, `app.kubernetes.io/name`, `app.kubernetes.io/part-of`, `app.kubernetes.io/managed-by`

**Annotations**: `openchoreo.dev/description`

### Copilot Chat Integration

On VSCode 1.99+ with GitHub Copilot, the extension registers the OpenChoreo MCP servers, named like the servers in the [OpenChoreo skills](https://github.com/openchoreo/skills):

| Server | Tools | Registered |
|---|---|---|
| `openchoreo-cp` | Developer toolsets: namespaces, projects, components, workloads, resources, deployments, builds, endpoints (1.4+) | Always |
| `openchoreo-pe` | Platform-engineer toolset: environments, pipelines, component types, traits, workflows, planes, authorization | When `openchoreo.mcp.platformEngineerTools` is on |
| `openchoreo-obs` | Observer: logs, metrics, traces, alerts, incidents | When an environment in the current namespace has an observability plane, or the platform advertises one |
| `openchoreo-sre` | SRE agent: root-cause reports and analysis | When the observability plane has an SRE agent |

The control plane offers more than 128 tools when every toolset is on, and chat requests are limited to 128, so the developer and platform-engineer toolsets are separate servers. Choose the control-plane toolsets with `openchoreo.mcp.toolsets`. If your role cannot read observability planes, set `openchoreo.mcp.observerUrl` / `openchoreo.mcp.sreAgentUrl`, or turn the observability servers off with `openchoreo.mcp.observability`.

**Skills, agents and instructions**: the extension ships the official [OpenChoreo agent skills](https://github.com/openchoreo/skills) (developer, platform engineer, their GitOps variants, setup, and migration), mirrored at a pinned commit on every build. It also adds:

- the **OpenChoreo Developer** custom agent, which uses `openchoreo-cp`, `openchoreo-obs` and `openchoreo-sre`;
- the **OpenChoreo Platform Engineer** agent, which uses `openchoreo-pe` and `openchoreo-obs` (shown when `openchoreo.mcp.platformEngineerTools` is on);
- instructions for working with OpenChoreo resource YAML.

**Chat tools**: the extension also gives agents three tools of its own, which you can reference in a prompt with `#`:

| Tool | Reference | What it does |
|---|---|---|
| Validate OpenChoreo YAML | `#openchoreoValidate` | Runs the extension's validation (schemas, misspelled fields, references) on a file, including unsaved edits, or on YAML text |
| Get OpenChoreo Context | `#openchoreoContext` | The occ session (control plane, namespace, project), server version and features, registered MCP servers, and the resource in the active editor |
| Scaffold OpenChoreo Resource | `#openchoreoScaffold` | Starter YAML for a kind, matching the server's version |

Find them in **Chat: Open Customizations**. If you install the OpenChoreo agent plugin yourself, turn off `openchoreo.ai.bundledSkills` to avoid duplicate skills. The occ binary the extension manages is added to the integrated terminal's `PATH` (`openchoreo.addCliToTerminalPath`), so commands that agents and skills run find it.

**MCP Server Auto-Registration**:
- URLs derived from your occ CLI control plane configuration and the namespace's observability planes (not hardcoded)
- Authentication token passed automatically from your session
- Re-registers when you switch context or namespace, or change an `openchoreo.mcp.*` setting

**Add to Chat** — right-click any resource in the tree to add it as context to Copilot Chat:

- **Add to Chat** — populates the chat input with a resource reference (e.g., `Regarding OpenChoreo Component "api-service" in Project "my-project" in Namespace "dev": `). Type your question after the colon and press Enter.
- **Add YAML to Chat** — fetches the full resource YAML and populates the chat input with the content. Type your question and press Enter.

Both actions open Copilot Chat without auto-submitting, so you can compose your question before sending.

### Status Bar

The status bar shows your current connection status using the custom OpenChoreo icon font:

- Connected: `[OC logo] {context} [namespace icon] {namespace}` — the tooltip adds the control plane URL and the server and `occ` CLI versions
- Not connected: `OC: Not connected`

Click to switch context.

### Debug Logging

View diagnostic information in **Output > OpenChoreo**:

- Token refresh flow (expiry, OIDC discovery, success/failure)
- API client creation
- Resource name/schema push to language server
- Namespace switches

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `openchoreo.configPath` | `""` | Path to occ CLI config file. Defaults to `~/.openchoreo/config` |
| `openchoreo.cliPath` | `""` | Path to the `occ` binary. Overrides the extension-managed download and the `PATH` lookup |
| `openchoreo.autoRefresh` | `false` | Automatically refresh resource tree on changes |
| `openchoreo.autoRefreshInterval` | `30` | Auto-refresh interval in seconds |

## Supported Resource Types

### Namespace-Scoped
Project, Component, Environment, DataPlane, WorkflowPlane, ObservabilityPlane, ComponentType, ResourceType, ProjectType (1.3+), Workflow, Trait, Workload, DeploymentPipeline, SecretReference, ReleaseBinding, Resource, ResourceReleaseBinding, ProjectReleaseBinding (1.3+), ObservabilityAlertsNotificationChannel, WorkflowRun (read-only), ComponentRelease (read-only), ResourceRelease, ProjectRelease (read-only, 1.3+)

### Cluster-Scoped
ClusterComponentType, ClusterResourceType, ClusterProjectType (1.3+), ClusterWorkflow, ClusterTrait, ClusterDataPlane, ClusterWorkflowPlane, ClusterObservabilityPlane

### RBAC
AuthzRole, AuthzRoleBinding (in Namespace Resources), ClusterAuthzRole, ClusterAuthzRoleBinding (in Cluster Resources) — full CRUD support including scaffolds, create, edit, and delete (RBAC-gated)

## Commands

| Command | Description |
|---|---|
| `OpenChoreo: Login (via occ CLI)` | Opens a terminal with `occ login` |
| `OpenChoreo: Select Namespace` | Switch namespace or create a new one (syncs to occ config) |
| `OpenChoreo: Switch Context` | Switch occ CLI context or create a new one |
| `OpenChoreo: Create New Resource` | Create from scaffold template (command palette) |
| `OpenChoreo: Delete` | Delete resource (tree context menu) |
| `OpenChoreo: Generate Release` | Create immutable release snapshot from component (tree context menu) |
| `OpenChoreo: Trigger Build` | Trigger the component's configured workflow directly (tree context menu) |
| `OpenChoreo: Trigger Build with Parameters` | Open pre-filled WorkflowRun YAML for the component's workflow (tree context menu) |
| `OpenChoreo: Run Workflow` | Run a generic Workflow/ClusterWorkflow (tree context menu) |
| `OpenChoreo: Promote` | Promote a release binding to the next pipeline environment (tree context menu) |
| `OpenChoreo: Deploy Release...` | Deploy a release to an inactive pipeline environment (tree context menu) |
| `OpenChoreo: Deploy to Environment...` | Deploy a ComponentRelease to a chosen environment (tree context menu) |
| `OpenChoreo: View Logs` | View all workflow run logs (tree context menu) |
| `OpenChoreo: View Events` | View all workflow run Kubernetes events (tree context menu) |
| `OpenChoreo: View Step Logs` | View logs for a specific workflow run step (tree context menu) |
| `OpenChoreo: View Step Events` | View events for a specific workflow run step (tree context menu) |
| `OpenChoreo: View Pod Logs` | View deployed pod logs from release binding (tree context menu) |
| `OpenChoreo: Run Locally Against Environment` | Run a workload locally against an environment's dependencies via `occ remote` (Explorer context menu, Command Palette; 1.3+) |
| `OpenChoreo: Open Shell` | Interactive shell in a component's running pod via `occ component exec` (tree context menu; 1.3+) |
| `OpenChoreo: View Runtime Logs` | Query a component's runtime logs from the observability plane (tree context menu) |
| `OpenChoreo: Run Now (Scheduled Task)` | Start a one-off Job for a scheduled-task component (tree context menu; 1.3+) |
| `OpenChoreo: Scaffold Component from this Project` | Generate Component and Workload manifests from the open source folder |
| `OpenChoreo: Download occ CLI` | Download and verify the pinned `occ` CLI into extension storage |
| `OpenChoreo: View Definition` | View K8s resource YAML definition (tree context menu) |
| `OpenChoreo: Add to Chat` | Add resource reference to Copilot Chat (tree context menu) |
| `OpenChoreo: Add YAML to Chat` | Add full resource YAML to Copilot Chat (tree context menu) |

## Architecture

```
packages/
├── extension/           # Main VSCode extension
│   ├── src/
│   │   ├── auth/        # occ CLI session & token management
│   │   ├── api/         # Typed OpenChoreo API client, server version parsing
│   │   ├── kinds/       # Kind registry: API routes, scope, tree mapping, operations
│   │   ├── cli/         # occ CLI download & resolution
│   │   ├── scaffolder/  # Source-folder detection → Component/Workload YAML
│   │   ├── treeView/    # Data providers (used by webview sidebar)
│   │   ├── webview/     # WebviewViewProvider & message protocol
│   │   ├── filesystem/  # Virtual filesystem (openchoreo://)
│   │   ├── commands/    # Command handlers & namespace selector
│   │   ├── services/    # RBAC, delete, resource, YAML services
│   │   ├── mcp/         # MCP server auto-registration
│   │   ├── statusBar/   # Status bar with custom icon font
│   │   └── logging/     # Output channel logger
│   ├── resources/
│   │   ├── openchoreo.svg           # Activity bar icon
│   │   ├── openchoreo-icons.woff2   # Custom icon font (generated)
│   │   ├── openchoreo-icons.json    # Codepoint map (generated)
│   │   └── icons/                   # Material UI SVG source icons
│   └── scripts/
│       ├── generate-schemas.mjs     # Regenerate schemas/ from OpenChoreo CRDs
│       └── update-icon-font.mjs     # Sync font codepoints to package.json
├── webview-ui/          # Preact-based sidebar webview
│   ├── src/
│   │   ├── components/  # TreeNode, TreeSection, NamespaceHeader, icons
│   │   ├── hooks/       # VS Code API wrapper
│   │   ├── styles/      # CSS with VS Code theme variables
│   │   └── types/       # Protocol & node type mirrors
│   └── build.mjs        # esbuild config
├── language-server/     # LSP server (separate process)
│   └── src/
│       ├── completion/  # YAML + CEL completions
│       ├── validation/  # Schema, CEL, reference validators
│       ├── hover/       # Hover documentation
│       ├── symbols/     # Document symbols (outline)
│       └── schemas/     # Schema loader
└── schemas/             # JSON Schemas generated from the OpenChoreo CRDs (+ refs.json overlay)
```

### Kind Registry

`src/kinds/registry.ts` is the single source of truth for every resource kind the OpenChoreo API serves: collection and item routes (type-checked against the client's route list, so a wrong path fails `tsc`), scope, tree node type, and which operations the tree offers. API calls, delete permissions, editability and the language-server feed all read from it. Supporting a new kind starts with a registry entry.

### Icon Font

Custom icons are generated from SVG source files using [fantasticon](https://github.com/tancredi/fantasticon):

```bash
cd packages/extension
pnpm generate:icons    # Generates WOFF2 font + JSON codepoints + updates package.json
```

To add a new icon: drop an SVG into `resources/icons/`, run `pnpm generate:icons`. The codepoints are auto-synced to both `package.json` (for VS Code `contributes.icons`) and the webview (via JSON import).

## OpenChoreo Version Support

| Control plane | Status |
|---|---|
| 1.3.x | Fully supported — client, `occ`, schemas and scaffolds target 1.3.3 |
| 1.4 milestones (m.1, m.2) | Supported; 1.4-only kinds (Endpoints, Release Lines) aren't surfaced yet |
| 1.1.x, 1.2.x | Core browsing and editing are expected to work (not re-tested for this release); *1.3+* features report that they need 1.3 |

The extension reads the control plane version from `/version` when it connects.

## License

Apache-2.0

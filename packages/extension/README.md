# OpenChoreo (Unofficial) for Visual Studio Code

> ⚠️ **Unofficial extension.** This extension is **not affiliated with, endorsed by, or officially maintained by OpenChoreo**. It is a community project published under a personal account. For the official OpenChoreo project visit <https://openchoreo.dev>.

IDE-native tooling for the [OpenChoreo](https://openchoreo.dev) developer platform — resource management, CRD editing with intelligent completions, and AI-powered workflows via MCP.

## Prerequisites

- **VSCode** 1.85+ (1.99+ recommended for MCP/Copilot features)
- **occ CLI** installed and logged in — the extension reads authentication from the occ CLI config

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

When registered with VSCode Copilot Chat, the OpenChoreo MCP server receives the current Bearer token via HTTP headers. The token is refreshed automatically via the periodic refresh timer and session change events — ensuring MCP requests always use a valid token.

For clusters installed with **authentication disabled**, the extension registers the MCP server without an `Authorization` header and adds `?filterByAuthz=false` to the URL so the platform's per-user tool filter doesn't hide the catalog. The OpenChoreo control plane still enforces its own authorization independently.

### Enabling the MCP Server in Copilot Chat

VS Code does **not** auto-start newly-registered MCP servers — this is a security feature of the MCP API, not something the extension can override. After the OpenChoreo extension activates:

1. Open the Command Palette → **MCP: List Servers**.
2. Find **OpenChoreo Platform** in the list.
3. Click **Start** (you only need to do this once per machine).
4. Open Copilot Chat → tools picker — the OpenChoreo tools are now available.

If "OpenChoreo Platform" doesn't appear in the list at all, check that you are logged in via `occ login` and that the OpenChoreo Output panel shows a line like `MCP server providing: <url>`.

### Security Notes

- Tokens are stored in **plain text** in the occ CLI config file (same model as kubectl/kubeconfig)
- The extension does not implement its own OAuth flow — it delegates to the occ CLI
- No tokens are stored in VSCode settings, extension storage, or keychain
- All API communication uses the control plane URL from the occ CLI config

## Features

### Sidebar Explorer

A unified webview sidebar replaces the traditional tree views, providing a richer experience:

**Context Header** — shows the current context and namespace as clickable chips with custom icons. Click to switch context or select a namespace.

**Projects** — Projects, Components, Deployment Pipelines, Workflow Runs, Releases, Release Bindings, Workloads

**Namespace Resources** — Environments, Data Planes, Workflow Planes, Observability Planes, Component Types, Workflows, Traits, Secret References, RBAC Roles & Bindings

**Cluster Resources** — Cluster-scoped variants of infrastructure resources and Cluster RBAC

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
- **Read-only resources** — Workflow Runs and Component Releases open as read-only (no PUT endpoint)

### Resource Creation

Click the **+** button on a tree category or project to create a new resource from a scaffold template:

- The scaffold opens as a dirty virtual file pre-filled with namespace and project context
- Edit the template, then **Cmd+S** to create the resource on the cluster (uses POST)
- After successful creation, the tab reopens pointing to the actual resource

Available scaffolds: Project, Component, ComponentType, Trait, Environment, DataPlane, WorkflowPlane, ObservabilityPlane, Workflow, Workload, DeploymentPipeline, SecretReference, AuthzRole, AuthzRoleBinding, ClusterAuthzRole, ClusterAuthzRoleBinding

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
| `spec.workflow.name` | Workflows + ClusterWorkflows |
| `spec.traits[].name` | Traits + ClusterTraits |
| `spec.owner.projectName` | Projects |
| `spec.dataPlaneRef.name` | DataPlanes |
| `spec.deploymentPipelineRef.name` | DeploymentPipelines |
| `spec.environment` | Environments |
| `spec.workflowPlaneRef.name` | WorkflowPlanes |

#### Cross-Document Schema Completions

When editing a **Component**, `spec.parameters` offers property completions from the referenced ComponentType's `openAPIV3Schema` — including types, defaults, and enum values.

Similarly, **ReleaseBinding** `componentTypeEnvironmentConfigs` offers properties from the ComponentType's environment config schema. Component `spec.traits[].parameters` offers from Trait schemas.

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
- **`kind:` field** — all 31 OpenChoreo CRD kinds
- **`apiVersion:` field** — `openchoreo.dev/v1alpha1`

### Schema Validation

Real-time diagnostics as you type:

- **Type checking** — detects mismatches (string where integer expected, etc.)
- **Required fields** — errors for missing required properties
- **Unknown properties** — warnings for fields not in the schema (when `additionalProperties: false`)
- **Const validation** — errors when a field doesn't match its required value
- **Enum validation** — errors for values not in the allowed set
- **String constraints** — warnings for `minLength`, `maxLength`, `pattern` violations
- **Number constraints** — warnings for `minimum`/`maximum` violations
- **Array validation** — validates items against the items schema, checks `minItems`/`maxItems`

### CEL Expression Validation

Inside `${...}` expressions:

- **Unclosed expressions** — error for missing closing `}`
- **Empty expressions** — warning for `${}`
- **Unknown variables** — warning when the first identifier isn't a known context variable
- **Type skip** — CEL expressions correctly skip type validation (dynamic values are validated at render time, not edit time)

### Cross-Resource Reference Validation

Fields referencing other resources show **warnings** if the referenced resource doesn't exist in the current namespace. Supports merged references (e.g., `ComponentType+ClusterComponentType` — checks both).

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

On VSCode 1.99+ with GitHub Copilot, the extension automatically registers the OpenChoreo Platform MCP server, giving Copilot Chat access to all OpenChoreo tools (resource CRUD, build triggers, observability queries, etc.).

**MCP Server Auto-Registration**:
- URL derived from your occ CLI control plane configuration (not hardcoded)
- Authentication token passed automatically from your session
- Re-registers when you switch context or namespace

**Add to Chat** — right-click any resource in the tree to add it as context to Copilot Chat:

- **Add to Chat** — populates the chat input with a resource reference (e.g., `Regarding OpenChoreo Component "api-service" in Project "my-project" in Namespace "dev": `). Type your question after the colon and press Enter.
- **Add YAML to Chat** — fetches the full resource YAML and populates the chat input with the content. Type your question and press Enter.

Both actions open Copilot Chat without auto-submitting, so you can compose your question before sending.

### Status Bar

The status bar shows your current connection status using the custom OpenChoreo icon font:

- Connected: `[OC logo] {context} [namespace icon] {namespace}`
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
| `openchoreo.autoRefresh` | `false` | Automatically refresh resource tree on changes |
| `openchoreo.autoRefreshInterval` | `30` | Auto-refresh interval in seconds |

## Supported Resource Types

### Namespace-Scoped
Project, Component, Environment, DataPlane, WorkflowPlane, ObservabilityPlane, ComponentType, Workflow, Trait, Workload, DeploymentPipeline, SecretReference, ReleaseBinding, WorkflowRun (read-only), ComponentRelease (read-only)

### Cluster-Scoped
ClusterComponentType, ClusterWorkflow, ClusterTrait, ClusterDataPlane, ClusterWorkflowPlane, ClusterObservabilityPlane, ClusterRole, ClusterRoleBinding

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
| `OpenChoreo: View Definition` | View K8s resource YAML definition (tree context menu) |
| `OpenChoreo: Add to Chat` | Add resource reference to Copilot Chat (tree context menu) |
| `OpenChoreo: Add YAML to Chat` | Add full resource YAML to Copilot Chat (tree context menu) |

## Architecture

```
packages/
├── extension/           # Main VSCode extension
│   ├── src/
│   │   ├── auth/        # occ CLI session & token management
│   │   ├── api/         # Typed OpenChoreo API client
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
└── schemas/             # JSON Schema files for all CRD types
```

### Icon Font

Custom icons are generated from SVG source files using [fantasticon](https://github.com/tancredi/fantasticon):

```bash
cd packages/extension
pnpm generate:icons    # Generates WOFF2 font + JSON codepoints + updates package.json
```

To add a new icon: drop an SVG into `resources/icons/`, run `pnpm generate:icons`. The codepoints are auto-synced to both `package.json` (for VS Code `contributes.icons`) and the webview (via JSON import).

## License

Apache-2.0

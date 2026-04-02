# OpenChoreo for Visual Studio Code

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

### Security Notes

- Tokens are stored in **plain text** in the occ CLI config file (same model as kubectl/kubeconfig)
- The extension does not implement its own OAuth flow — it delegates to the occ CLI
- No tokens are stored in VSCode settings, extension storage, or keychain
- All API communication uses the control plane URL from the occ CLI config

## Features

### Resource Explorer

Three tree views organized by scope:

**Developer Resources** — Projects, Components, Deployment Pipelines, Workflow Runs, Releases, Release Bindings, Workloads

**Platform Resources** — Environments, Data Planes, Workflow Planes, Observability Planes, Component Types, Workflows, Traits, Secret References, RBAC Roles & Bindings

**Cluster Resources** — Cluster-scoped variants of infrastructure resources (ClusterComponentTypes, ClusterWorkflows, ClusterTraits, etc.) and Cluster RBAC

Each view shows the current namespace in the header. Click the namespace selector button to switch namespaces — the change syncs back to the occ CLI config.

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

Available scaffolds: Project, Component, ComponentType, Trait, Environment, DataPlane, WorkflowPlane, ObservabilityPlane, Workflow, Workload, DeploymentPipeline, SecretReference

### Workflow Run Observability

Expand any Workflow Run in the tree to see its step-by-step execution status:

- **Colored status icons** — green check (Succeeded), red X (Failed), spinning sync (Running), clock (Pending), skip (Skipped), warning (Error)
- **Step timing** — each step shows its phase and duration (e.g., `Succeeded (2m30s)`)
- **View Logs** — right-click a Workflow Run → "View Logs" to stream logs into an Output channel. Logs auto-refresh every 3 seconds while the channel is open, so new entries appear as the workflow progresses
- **View Events** — right-click a Workflow Run → "View Events" to see Kubernetes events. Events auto-refresh to show new events as they occur

Enable `openchoreo.autoRefresh` in settings to automatically poll running workflow run status.

### Deployed Resource Tree

Expand any Release Binding in the tree to see the Kubernetes resources deployed by that release:

- **Hierarchical view** — shows the full resource hierarchy (e.g., Deployment → ReplicaSet → Pod)
- **Health indicators** — colored icons for Healthy (green), Degraded (yellow), Progressing (blue), Missing (red)
- **Pod Logs** — right-click a Pod → "View Pod Logs" to stream container output. Logs auto-refresh every 3 seconds
- **Resource Events** — right-click any deployed resource → "View Events" to see Kubernetes events with auto-refresh

### Generate Release

Right-click a Component → "Generate Release" to create an immutable release snapshot from the current component state (ComponentType + Traits + Workload configuration). Optionally provide a release name or let the server auto-generate one.

### Trigger Build

Right-click a Component → "Trigger Build" to create a new Workflow Run:

1. A quick pick shows all available Workflows and ClusterWorkflows
2. Select a workflow to trigger
3. The run is created with labels linking it to the component and project
4. The Workflow Runs category refreshes to show the new run

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

The status bar shows your current connection status:

- Connected: `OC: {context} {namespace}`
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
NamespaceRole, NamespaceRoleBinding (in Platform Resources), ClusterRole, ClusterRoleBinding (in Cluster Resources)

## Commands

| Command | Description |
|---|---|
| `OpenChoreo: Login (via occ CLI)` | Opens a terminal with `occ login` |
| `OpenChoreo: Select Namespace` | Switch namespace (syncs to occ config) |
| `OpenChoreo: Switch Context` | Switch occ CLI context |
| `OpenChoreo: Refresh Resources` | Refresh Developer Resources tree |
| `OpenChoreo: Refresh Infrastructure` | Refresh Platform Resources tree |
| `OpenChoreo: Refresh Cluster Resources` | Refresh Cluster Resources tree |
| `OpenChoreo: Create New Resource` | Create from scaffold template (command palette) |
| `OpenChoreo: Delete` | Delete resource (tree context menu) |
| `OpenChoreo: Generate Release` | Create immutable release snapshot from component (tree context menu) |
| `OpenChoreo: Trigger Build` | Trigger a workflow run for a component (tree context menu) |
| `OpenChoreo: View Logs` | View workflow run logs in Output channel (tree context menu) |
| `OpenChoreo: View Events` | View workflow run Kubernetes events (tree context menu) |
| `OpenChoreo: View Pod Logs` | View deployed pod logs from release binding (tree context menu) |
| `OpenChoreo: Add to Chat` | Add resource reference to Copilot Chat (tree context menu) |
| `OpenChoreo: Add YAML to Chat` | Add full resource YAML to Copilot Chat (tree context menu) |

## Architecture

```
packages/
├── extension/           # Main VSCode extension
│   ├── src/
│   │   ├── auth/        # occ CLI session & token management
│   │   ├── api/         # Typed OpenChoreo API client
│   │   ├── treeView/    # 3 tree view providers
│   │   ├── filesystem/  # Virtual filesystem (openchoreo://)
│   │   ├── commands/    # Command handlers & namespace selector
│   │   ├── services/    # RBAC, delete, resource, YAML services
│   │   ├── mcp/         # MCP server auto-registration
│   │   └── logging/     # Output channel logger
│   └── resources/
│       ├── openchoreo.svg    # Activity bar icon
│       └── icons/            # Material UI SVG icons
├── language-server/     # LSP server (separate process)
│   └── src/
│       ├── completion/  # YAML + CEL completions
│       ├── validation/  # Schema, CEL, reference validators
│       ├── hover/       # Hover documentation
│       ├── symbols/     # Document symbols (outline)
│       └── schemas/     # Schema loader
└── schemas/             # JSON Schema files for all CRD types
```

## License

Apache-2.0

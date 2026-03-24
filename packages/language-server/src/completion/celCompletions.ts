// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver/node';

/**
 * CEL context variables available in ComponentType and Trait templates.
 * Structured as a tree for dot-completion.
 */
const CEL_CONTEXT: Record<string, {
  description: string;
  members?: Record<string, { description: string; members?: Record<string, { description: string }> }>;
}> = {
  metadata: {
    description: 'Component/project/environment identity and Kubernetes naming',
    members: {
      componentName: { description: 'Component resource name' },
      projectName: { description: 'Owning project name' },
      environmentName: { description: 'Target environment name' },
      dataPlaneName: { description: 'Target data plane name' },
      name: { description: 'Generated Kubernetes resource name (use as prefix)' },
      namespace: { description: 'Target Kubernetes namespace' },
      labels: { description: 'Standard OpenChoreo labels (map)' },
      annotations: { description: 'Annotations (map)' },
      podSelectors: { description: 'Pod selector labels for services (map)' },
    },
  },
  parameters: {
    description: 'Developer-facing parameters from Component spec (schema-pruned with defaults)',
  },
  environmentConfigs: {
    description: 'Per-environment overrides from ReleaseBinding',
  },
  workload: {
    description: 'Container and endpoint configuration from the build process',
    members: {
      container: {
        description: 'Container specification',
        members: {
          image: { description: 'OCI container image (digest or tag)' },
          command: { description: 'Container entrypoint override (string[])' },
          args: { description: 'Container arguments (string[])' },
        },
      },
      endpoints: { description: 'Named endpoint specifications (map)' },
    },
  },
  configurations: {
    description: 'Extracted env vars and files from workload, split into configs and secrets',
    members: {
      configs: {
        description: 'Non-secret configurations',
        members: {
          envs: { description: 'Config environment variables (list)' },
          files: { description: 'Config file mounts (list)' },
        },
      },
      secrets: {
        description: 'Secret configurations',
        members: {
          envs: { description: 'Secret environment variables (list)' },
          files: { description: 'Secret file mounts (list)' },
        },
      },
    },
  },
  dependencies: {
    description: 'Resolved connections to other components',
    members: {
      items: { description: 'Dependency items (list of {component, endpoint, envVars})' },
      envVars: { description: 'All dependency env vars merged (list)' },
    },
  },
  dataplane: {
    description: 'DataPlane configuration for the target environment',
    members: {
      secretStore: { description: 'Secret store name' },
      gateway: { description: 'Gateway configuration (ingress/egress)' },
    },
  },
  gateway: {
    description: 'Resolved gateway (environment override or dataplane fallback)',
    members: {
      ingress: {
        description: 'Ingress gateway',
        members: {
          external: { description: 'External gateway endpoint (name, namespace, http, https)' },
          internal: { description: 'Internal gateway endpoint' },
        },
      },
    },
  },
  environment: {
    description: 'Environment-specific configuration',
    members: {
      gateway: { description: 'Environment gateway override' },
      defaultNotificationChannel: { description: 'Default notification channel' },
    },
  },
  // Trait-specific
  trait: {
    description: 'Trait identity (only in Trait context)',
    members: {
      name: { description: 'Trait resource name' },
      instanceName: { description: 'Trait instance name on the component' },
    },
  },
  resource: {
    description: 'The Kubernetes resource being patched (only in patches[].target.where)',
  },
};

/** OpenChoreo custom CEL functions. */
const OC_FUNCTIONS: Array<{
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}> = [
  {
    label: 'oc_omit()',
    detail: 'Remove field from output',
    documentation: 'Returns a sentinel value that removes the field from the rendered resource. Use in conditional: `${has(x) ? x : oc_omit()}`',
    insertText: 'oc_omit()',
  },
  {
    label: 'oc_merge',
    detail: 'Shallow merge maps',
    documentation: 'Shallow merge of two or more maps. Later maps override earlier. `${oc_merge(base, override)}`',
    insertText: 'oc_merge(${1:base}, ${2:override})',
  },
  {
    label: 'oc_generate_name',
    detail: 'Generate K8s resource name (≤253 chars)',
    documentation: 'Generate a valid Kubernetes resource name with 8-char hash suffix. Same inputs → same output. `${oc_generate_name(metadata.name, "suffix")}`',
    insertText: 'oc_generate_name(${1:metadata.name}, ${2:"suffix"})',
  },
  {
    label: 'oc_dns_label',
    detail: 'Generate DNS label (≤63 chars)',
    documentation: 'Like oc_generate_name but max 63 characters for DNS label compliance.',
    insertText: 'oc_dns_label(${1:name}, ${2:metadata.componentName})',
  },
  {
    label: 'oc_hash',
    detail: 'Generate 8-char hash',
    documentation: 'FNV-1a 32-bit hash of input string, returned as 8-char hex.',
    insertText: 'oc_hash(${1:input})',
  },
];

/** Configuration helper macros. */
const CONFIG_HELPERS: Array<{
  label: string;
  detail: string;
  documentation: string;
}> = [
  { label: 'configurations.toContainerEnvFrom()', detail: 'List of envFrom refs', documentation: 'Generates configMapRef and secretRef entries for container envFrom.' },
  { label: 'configurations.toContainerVolumeMounts()', detail: 'List of volume mounts', documentation: 'Generates volumeMount entries for container.' },
  { label: 'configurations.toVolumes()', detail: 'List of volumes', documentation: 'Generates volume entries for pod spec.' },
  { label: 'configurations.toConfigFileList()', detail: 'Config file list', documentation: 'List of config file entries with name, mountPath, value.' },
  { label: 'configurations.toSecretFileList()', detail: 'Secret file list', documentation: 'List of secret file entries with name, mountPath, remoteRef.' },
  { label: 'configurations.toConfigEnvsByContainer()', detail: 'Config envs grouped', documentation: 'Config env vars grouped by container.' },
  { label: 'configurations.toSecretEnvsByContainer()', detail: 'Secret envs grouped', documentation: 'Secret env vars grouped by container.' },
  { label: 'workload.toServicePorts()', detail: 'List of service ports', documentation: 'Generates service port entries from workload endpoints.' },
  { label: 'dependencies.toContainerEnvs()', detail: 'Dependency env vars', documentation: 'Merged list of all resolved dependency environment variables.' },
];

/** Standard CEL builtin functions and methods. */
const CEL_BUILTINS: Array<{
  label: string;
  detail: string;
  insertText: string;
}> = [
  { label: 'has', detail: 'Check field existence', insertText: 'has(${1:field})' },
  { label: 'size', detail: 'Length of list/map/string', insertText: 'size(${1:value})' },
  { label: 'type', detail: 'Get type of value', insertText: 'type(${1:value})' },
  { label: 'int', detail: 'Convert to integer', insertText: 'int(${1:value})' },
  { label: 'string', detail: 'Convert to string', insertText: 'string(${1:value})' },
  { label: 'math.greatest', detail: 'Maximum of list', insertText: 'math.greatest(${1:list})' },
  { label: 'math.least', detail: 'Minimum of list', insertText: 'math.least(${1:list})' },
  { label: 'math.ceil', detail: 'Ceiling', insertText: 'math.ceil(${1:value})' },
  { label: 'base64.encode', detail: 'Base64 encode', insertText: 'base64.encode(bytes(${1:value}))' },
  { label: 'base64.decode', detail: 'Base64 decode', insertText: 'string(base64.decode(${1:value}))' },
];

/** CEL list/map method completions (offered after `.`). */
const CEL_METHODS: Array<{
  label: string;
  detail: string;
  insertText: string;
}> = [
  { label: 'map', detail: 'Transform each element', insertText: 'map(${1:item}, ${2:expr})' },
  { label: 'filter', detail: 'Filter elements', insertText: 'filter(${1:item}, ${2:condition})' },
  { label: 'exists', detail: 'Check if any match', insertText: 'exists(${1:item}, ${2:condition})' },
  { label: 'all', detail: 'Check if all match', insertText: 'all(${1:item}, ${2:condition})' },
  { label: 'flatten', detail: 'Flatten nested lists', insertText: 'flatten()' },
  { label: 'sort', detail: 'Sort primitives', insertText: 'sort()' },
  { label: 'sortBy', detail: 'Sort by field', insertText: 'sortBy(${1:item}, ${2:item.field})' },
  { label: 'join', detail: 'Join strings', insertText: 'join(${1:","}' },
  { label: 'size', detail: 'Length', insertText: 'size()' },
  { label: 'transformList', detail: 'Map to list', insertText: 'transformList(${1:key}, ${2:val}, ${3:expr})' },
  { label: 'transformMap', detail: 'Map to map', insertText: 'transformMap(${1:key}, ${2:val}, ${3:expr})' },
  { label: 'transformMapEntry', detail: 'List to map', insertText: 'transformMapEntry(${1:item}, ${2:expr})' },
  // String methods
  { label: 'split', detail: 'Split string', insertText: 'split(${1:"/"})' },
  { label: 'trim', detail: 'Trim whitespace', insertText: 'trim()' },
  { label: 'replace', detail: 'Replace substring', insertText: 'replace(${1:"old"}, ${2:"new"})' },
  { label: 'substring', detail: 'Extract substring', insertText: 'substring(${1:0}, ${2:5})' },
  { label: 'upperAscii', detail: 'Uppercase', insertText: 'upperAscii()' },
  { label: 'lowerAscii', detail: 'Lowercase', insertText: 'lowerAscii()' },
  { label: 'startsWith', detail: 'Check prefix', insertText: 'startsWith(${1:"prefix"})' },
  { label: 'endsWith', detail: 'Check suffix', insertText: 'endsWith(${1:"suffix"})' },
  { label: 'contains', detail: 'Check substring', insertText: 'contains(${1:"text"})' },
  // Optional
  { label: 'orValue', detail: 'Default for optional', insertText: 'orValue(${1:default})' },
];

/**
 * Check if the cursor is inside a CEL expression (after `${` without closing `}`).
 */
export function isInsideCelExpression(line: string, character: number): boolean {
  const before = line.substring(0, character);
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === '}') {
      depth++;
    } else if (before[i] === '{' && i > 0 && before[i - 1] === '$') {
      if (depth === 0) {
        return true;
      }
      depth--;
    }
  }
  return false;
}

/**
 * Get the CEL expression text before the cursor (for dot-completion context).
 */
function getCelPrefix(line: string, character: number): string {
  const before = line.substring(0, character);
  // Find the start of the current CEL expression
  let start = before.length;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === '{' && i > 0 && before[i - 1] === '$') {
      start = i + 1;
      break;
    }
  }
  return before.substring(start);
}

/**
 * Get CEL completion items based on cursor context.
 */
export function getCelCompletionItems(
  line: string,
  character: number,
  crdKind: string,
): CompletionItem[] {
  const prefix = getCelPrefix(line, character);
  const items: CompletionItem[] = [];

  // Check if we're after a dot (member completion)
  const dotIndex = prefix.lastIndexOf('.');
  if (dotIndex >= 0) {
    const varPath = prefix.substring(0, dotIndex).trim();

    // Try to resolve the variable path to offer member completions
    const parts = varPath.split('.');
    let current = CEL_CONTEXT[parts[0]];
    for (let i = 1; i < parts.length && current?.members; i++) {
      const member = current.members[parts[i]];
      if (member && 'members' in member) {
        current = member as typeof current;
      } else {
        current = undefined as unknown as typeof current;
        break;
      }
    }

    // Offer members of the resolved variable
    if (current?.members) {
      for (const [name, info] of Object.entries(current.members)) {
        items.push({
          label: name,
          kind: CompletionItemKind.Field,
          detail: info.description,
          insertText: name,
        });
      }
    }

    // Always offer CEL methods after a dot
    for (const method of CEL_METHODS) {
      items.push({
        label: method.label,
        kind: CompletionItemKind.Method,
        detail: method.detail,
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: method.insertText,
      });
    }

    return items;
  }

  // Top-level completions (no dot)

  // Context variables
  for (const [name, info] of Object.entries(CEL_CONTEXT)) {
    // Skip trait-specific vars for non-trait kinds
    if (name === 'trait' && !crdKind.includes('Trait')) continue;
    if (name === 'resource' && !crdKind.includes('Trait')) continue;

    items.push({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: info.description,
      insertText: name,
    });
  }

  // OC functions
  for (const fn of OC_FUNCTIONS) {
    items.push({
      label: fn.label,
      kind: CompletionItemKind.Function,
      detail: fn.detail,
      documentation: { kind: MarkupKind.Markdown, value: fn.documentation },
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: fn.insertText,
    });
  }

  // Config helpers
  for (const helper of CONFIG_HELPERS) {
    items.push({
      label: helper.label,
      kind: CompletionItemKind.Function,
      detail: helper.detail,
      documentation: helper.documentation,
      insertText: helper.label,
    });
  }

  // Builtin functions
  for (const fn of CEL_BUILTINS) {
    items.push({
      label: fn.label,
      kind: CompletionItemKind.Function,
      detail: fn.detail,
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: fn.insertText,
    });
  }

  return items;
}

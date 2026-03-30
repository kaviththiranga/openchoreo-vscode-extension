// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import { log } from '../logging/logger';

const PARTICIPANT_ID = 'openchoreo';
const MAX_TOOL_ROUNDS = 10;

const BASE_SYSTEM_PROMPT = `You are OpenChoreo Assistant, an expert on the OpenChoreo developer platform.
You help users manage their cloud-native applications, deployments, and infrastructure.
Use the available tools to get real data from the cluster.
Be concise and actionable. Format YAML and JSON in code blocks.`;

/**
 * Tool name patterns for each resource type.
 * Used to filter tools when "Add to Chat" provides a resource context.
 */
const RESOURCE_TOOL_PATTERNS: Record<string, string[]> = {
  component: ['component', 'workload', 'release_binding', 'workflow_run', 'schema', 'logs', 'metrics', 'traces', 'span'],
  project: ['project', 'component', 'deployment_pipeline'],
  environment: ['environment', 'dataplane', 'deployment_pipeline'],
  'component-type': ['component_type', 'cluster_component_type'],
  'cluster-component-type': ['component_type', 'cluster_component_type'],
  trait: ['trait', 'cluster_trait'],
  'cluster-trait': ['trait', 'cluster_trait'],
  workflow: ['workflow', 'cluster_workflow'],
  'cluster-workflow': ['workflow', 'cluster_workflow'],
  'workflow-run': ['workflow_run', 'workflow_log'],
  'release-binding': ['release_binding', 'component_release', 'deployment_pipeline'],
  'component-release': ['component_release', 'release_binding'],
  'data-plane': ['dataplane', 'cluster_dataplane'],
  'cluster-data-plane': ['dataplane', 'cluster_dataplane'],
  'workflow-plane': ['workflowplane', 'cluster_workflowplane'],
  'cluster-workflow-plane': ['workflowplane', 'cluster_workflowplane'],
  'observability-plane': ['observability_plane', 'cluster_observability_plane'],
  'cluster-observability-plane': ['observability_plane', 'cluster_observability_plane'],
  'deployment-pipeline': ['deployment_pipeline', 'environment'],
  workload: ['workload', 'component', 'release_binding'],
  'secret-reference': ['secret_reference', 'namespace'],
};

/** Core tools always included regardless of resource context. */
const CORE_TOOL_PATTERNS = ['list_namespaces', 'list_projects'];

/**
 * Filter tools based on resource type context.
 * Returns all tools if no resource type specified or under 128 total.
 */
function filterTools(
  allTools: readonly vscode.LanguageModelToolInformation[],
  resourceType?: string,
): vscode.LanguageModelToolInformation[] {
  // If under the limit, no filtering needed
  if (allTools.length <= 128 && !resourceType) {
    return [...allTools];
  }

  if (!resourceType) {
    // No context — take first 128
    return [...allTools].slice(0, 128);
  }

  const patterns = RESOURCE_TOOL_PATTERNS[resourceType];
  if (!patterns) {
    return [...allTools].slice(0, 128);
  }

  const allPatterns = [...patterns, ...CORE_TOOL_PATTERNS];
  const filtered = allTools.filter((tool) => {
    const name = tool.name.toLowerCase();
    return allPatterns.some((p) => name.includes(p));
  });

  log.debug(`@openchoreo: filtered ${allTools.length} tools to ${filtered.length} for ${resourceType}`);
  return filtered;
}

/**
 * Register the @openchoreo chat participant with MCP tool loop.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
): void {
  if (!vscode.chat?.createChatParticipant) {
    log.debug('Chat participant API not available');
    return;
  }

  try {
    const handler: vscode.ChatRequestHandler = async (
      request,
      chatContext,
      response,
      token,
    ) => {
      const contextInfo = authProvider.getContextInfo();
      const ns = contextInfo?.namespace ?? 'not set';

      // Extract resource context from the prompt (injected by "Add to Chat")
      let resourceType: string | undefined;
      const contextMatch = request.prompt.match(/\[(\w[\w-]*?):/);
      if (contextMatch) {
        // Map kind back to node type
        const kindToType: Record<string, string> = {
          Component: 'component', Project: 'project', Environment: 'environment',
          ComponentType: 'component-type', ClusterComponentType: 'cluster-component-type',
          Trait: 'trait', ClusterTrait: 'cluster-trait',
          Workflow: 'workflow', ClusterWorkflow: 'cluster-workflow',
          WorkflowRun: 'workflow-run', ReleaseBinding: 'release-binding',
          ComponentRelease: 'component-release', DataPlane: 'data-plane',
          WorkflowPlane: 'workflow-plane', ObservabilityPlane: 'observability-plane',
          Workload: 'workload', SecretReference: 'secret-reference',
          DeploymentPipeline: 'deployment-pipeline',
        };
        resourceType = kindToType[contextMatch[1]];
      }

      // Get and filter tools
      const allTools = vscode.lm.tools ?? [];
      const tools = filterTools(allTools, resourceType);

      // Log tool names on first use (helps debug naming convention)
      if (allTools.length > 0) {
        log.debug(`@openchoreo: total tools=${allTools.length}, filtered=${tools.length}, names: ${tools.slice(0, 5).map(t => t.name).join(', ')}...`);
      }

      // Build system prompt with context
      let systemPrompt = `${BASE_SYSTEM_PROMPT}\n\nCurrent context:\n- Namespace: ${ns}\n- Control Plane: ${contextInfo?.controlPlaneUrl ?? 'unknown'}`;
      if (resourceType) {
        systemPrompt += `\n\nNote: You have tools focused on ${resourceType} resources. If the user asks about other resource types, suggest they use @openchoreo without a resource context for full platform access.`;
      }

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
      ];

      // Include conversation history for multi-turn context
      for (const turn of chatContext.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
          messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        } else if (turn instanceof vscode.ChatResponseTurn) {
          const responseText = turn.response
            .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
            .map((part) => part.value.value)
            .join('');
          if (responseText) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
          }
        }
      }

      // Current user message
      messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

      // Tool call loop
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const chatResponse = await request.model.sendRequest(
            messages,
            {
              tools,
              toolMode: vscode.LanguageModelChatToolMode?.Auto,
            },
            token,
          );

          const toolCalls: vscode.LanguageModelToolCallPart[] = [];

          for await (const part of chatResponse.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
              response.markdown(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
              toolCalls.push(part);
            }
          }

          if (toolCalls.length === 0) break;

          for (const toolCall of toolCalls) {
            log.debug(`@openchoreo: invoking tool ${toolCall.name}`);
            response.progress(`Calling ${toolCall.name}...`);

            try {
              const toolResult = await vscode.lm.invokeTool(
                toolCall.name,
                {
                  input: toolCall.input,
                  toolInvocationToken: request.toolInvocationToken,
                },
                token,
              );

              messages.push(
                vscode.LanguageModelChatMessage.Assistant([toolCall]),
              );
              messages.push(
                vscode.LanguageModelChatMessage.User([
                  new vscode.LanguageModelToolResultPart(
                    toolCall.callId,
                    (toolResult as vscode.LanguageModelToolResult).content,
                  ),
                ]),
              );
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : 'Tool invocation failed';
              log.error(`@openchoreo: tool ${toolCall.name} failed`, err);
              messages.push(
                vscode.LanguageModelChatMessage.Assistant([toolCall]),
              );
              messages.push(
                vscode.LanguageModelChatMessage.User([
                  new vscode.LanguageModelToolResultPart(toolCall.callId, [
                    new vscode.LanguageModelTextPart(`Error: ${errorMsg}`),
                  ]),
                ]),
              );
            }
          }
        }
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          response.markdown(`*${err.message}*`);
        } else {
          throw err;
        }
      }

      return { metadata: { command: '' } };
    };

    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'openchoreo.svg');
    context.subscriptions.push(participant);
    log.info('@openchoreo chat participant registered');
  } catch (err) {
    log.error('Failed to register chat participant', err);
  }
}

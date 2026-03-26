// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { OccConfigAuthProvider } from '../auth/authProvider';
import type { ApiClientManager } from '../api/apiClient';
import { fetchResource } from '../services/apiRoutes';
import { crdToYaml } from '../services/yamlService';
import { ResourceService } from '../services/resourceService';
import { log } from '../logging/logger';

const PARTICIPANT_ID = 'openchoreo';

const SYSTEM_PROMPT = `You are OpenChoreo Assistant, an expert on the OpenChoreo developer platform.
You help users manage their cloud-native applications, deployments, and infrastructure.

You have access to OpenChoreo MCP tools that can:
- List, create, update, and delete resources (projects, components, environments, etc.)
- Trigger builds and workflow runs
- Query logs, metrics, traces, alerts, and incidents
- Manage deployment pipelines and release bindings

When answering questions:
- Be concise and actionable
- Reference specific resource names and namespaces
- Suggest relevant MCP tool calls when appropriate
- Format YAML examples in code blocks`;

/**
 * Register the @openchoreo chat participant.
 *
 * Forwards user prompts to the LLM with OpenChoreo context (namespace, resource YAMLs),
 * allowing Copilot + MCP tools to answer platform questions.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  authProvider: OccConfigAuthProvider,
  apiClientManager: ApiClientManager,
): void {
  if (!vscode.chat?.createChatParticipant) {
    log.debug('Chat participant API not available');
    return;
  }

  try {
    const handler: vscode.ChatRequestHandler = async (
      request,
      _chatContext,
      response,
      token,
    ) => {
      const contextInfo = authProvider.getContextInfo();
      const ns = contextInfo?.namespace ?? 'unknown';

      // Build context with namespace info and any resource references
      let resourceContext = '';

      // Process resource references added via "Add to Chat"
      for (const ref of request.references) {
        if (typeof ref.value === 'object' && ref.value && 'type' in ref.value) {
          const resourceRef = ref.value as { type: string; namespace?: string; name: string };
          try {
            const client = await apiClientManager.getClient();
            if (client) {
              const data = await fetchResource(
                client,
                resourceRef.type,
                resourceRef.namespace ?? ns,
                resourceRef.name,
              );
              if (data) {
                const crd = data as Record<string, unknown>;
                const resourceService = new ResourceService();
                const kind = resourceService.getCrdKind(resourceRef.type as never) ?? resourceRef.type;
                if (!crd.apiVersion) {
                  crd.apiVersion = 'openchoreo.dev/v1alpha1';
                  crd.kind = kind;
                }
                const yaml = crdToYaml(crd);
                resourceContext += `\n\nResource ${kind}/${resourceRef.name}:\n\`\`\`yaml\n${yaml}\`\`\``;
              }
            }
          } catch {
            // Skip failed resource fetches
          }
        }
      }

      // Build messages for the LLM
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(
          `${SYSTEM_PROMPT}\n\nCurrent OpenChoreo context:\n- Namespace: ${ns}\n- Control Plane: ${contextInfo?.controlPlaneUrl ?? 'unknown'}${resourceContext}`,
        ),
        vscode.LanguageModelChatMessage.User(request.prompt),
      ];

      // Forward to the LLM (uses the model selected in Copilot Chat)
      try {
        const chatResponse = await request.model.sendRequest(messages, {}, token);

        for await (const fragment of chatResponse.text) {
          response.markdown(fragment);
        }
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          if (err.code === vscode.LanguageModelError.NotFound.name) {
            response.markdown('No language model available. Please ensure GitHub Copilot is active.');
          } else if (err.code === vscode.LanguageModelError.Blocked.name) {
            response.markdown('The request was blocked by the language model content filter.');
          } else {
            response.markdown(`Language model error: ${err.message}`);
          }
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

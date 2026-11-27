// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP servers, skills and agents, the other-agents guide and the chat hand-offs.
 *
 * Workspace: demo/seed/workspaces-ai.sh prepares ~/demo-ws/ai/snip-api-service.
 * Run with DEMO_WITH=cluster and
 *   DEMO_SETTINGS='{"openchoreo.mcp.platformEngineerTools":true,"chat.titleBar.signIn.enabled":false,"chat.viewSessions.enabled":false}'
 * (chat stays on: never chat.disableAIFeatures here). The answering scenes
 * also need DEMO_WITH=copilot and a profile signed in to GitHub Copilot.
 */
import type { Scene } from '../../demo';
import { agentFixesYaml, agentTroubleshootsBuild } from './agentScenes';
import { aiCustomizations } from './aiCustomizations';
import { chatAddYaml, troubleshootBuild } from './chatHandoffs';
import { fixWithCopilot } from './fixWithCopilot';
import { mcpServers } from './mcpServers';
import { otherAgents } from './otherAgents';

export const aiScenes: Scene[] = [
  mcpServers,
  aiCustomizations,
  otherAgents,
  chatAddYaml,
  troubleshootBuild,
  fixWithCopilot,
  agentTroubleshootsBuild,
  agentFixesYaml,
];

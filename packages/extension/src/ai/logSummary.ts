// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/** Lines sent to the model; the most recent ones matter most. */
const MAX_LINES = 400;
const MAX_CHARS = 60_000;

export function logSummaryPrompt(subject: string, lines: string[]): string {
  let recent = lines.slice(-MAX_LINES).join('\n');
  if (recent.length > MAX_CHARS) recent = recent.slice(-MAX_CHARS);
  const omitted = lines.length > MAX_LINES ? ` (the last ${MAX_LINES} of ${lines.length} lines)` : '';
  return (
    `These are runtime logs of ${subject}${omitted}. Summarize what the service is doing, ` +
    'list any errors or warnings with how often they occur and their likely cause, and say what to check next. ' +
    'Be brief and use plain text.\n\n' +
    recent
  );
}

/**
 * Summarizes logs with a chat model the user already has (Copilot or a model
 * they added), streaming into `write`. VS Code asks the user for consent the
 * first time the extension uses a model.
 */
export async function summarizeLogs(
  subject: string,
  lines: string[],
  write: (text: string) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  if (!vscode.lm?.selectChatModels) throw new Error('This editor has no language model API.');
  const [model] = await vscode.lm.selectChatModels();
  if (!model) throw new Error('No chat model is available. Sign in to GitHub Copilot or add a model.');
  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(logSummaryPrompt(subject, lines))],
    { justification: 'Summarize OpenChoreo runtime logs you asked to view.' },
    token,
  );
  write(`\n── Summary by ${model.name} ──\n`);
  for await (const chunk of response.text) write(chunk);
  write('\n');
}

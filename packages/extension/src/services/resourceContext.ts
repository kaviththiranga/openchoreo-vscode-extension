// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'crypto';

interface ContextInfo { contextName: string; controlPlaneUrl: string; }
let currentContextId = '';
export function resourceContextId(info: ContextInfo | undefined): string {
  return info ? createHash('sha256').update(JSON.stringify([info.controlPlaneUrl, info.contextName])).digest('hex') : '';
}
export function setResourceContextId(id: string): void { currentContextId = id; }
export function getResourceContextId(): string { return currentContextId; }

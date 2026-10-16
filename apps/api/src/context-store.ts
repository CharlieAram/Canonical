import { ContextWorkspaceSchema, type ContextStore, type ContextWorkspace } from '@canonical/contracts';

export function createMemoryContextStore(): ContextStore {
  const workspaces = new Map<string, ContextWorkspace>();
  return {
    async get(runId) { return structuredClone(workspaces.get(runId)); },
    async save(workspace, expectedRevision) {
      const parsed = ContextWorkspaceSchema.parse(workspace);
      const current = workspaces.get(parsed.runId);
      if ((current?.revision ?? 0) !== expectedRevision) return false;
      if (parsed.revision !== expectedRevision + 1) throw new Error('Context revision must advance exactly once');
      workspaces.set(parsed.runId, structuredClone(parsed));
      return true;
    },
  };
}

import { createMemoryContextStore } from './context-store.ts';
import { RunSchema, type AnalysisRun, type RunStore } from '@canonical/contracts';
import { connectSurreal, createSurrealStore } from '@canonical/integrations/surrealdb';
import type { readConfig } from './config.ts';

export function createMemoryStore(): RunStore {
  const runs = new Map<string, AnalysisRun>();
  return {
    kind: 'memory',
    context: createMemoryContextStore(),
    async save(run) { runs.set(run.id, structuredClone(RunSchema.parse(run))); },
    async get(id) { return structuredClone(runs.get(id)); },
    async list() {
      return structuredClone([...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20));
    },
    async close() { runs.clear(); },
  };
}

export async function createStore(config: ReturnType<typeof readConfig>): Promise<RunStore> {
  if (config.storage === 'memory') return createMemoryStore();
  // Explicit choice: an unreachable database is an error, never a silent memory fallback.
  return createSurrealStore(await connectSurreal(config.surreal));
}

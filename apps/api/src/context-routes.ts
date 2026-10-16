import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  ContextImportSchema, CreateProposalSchema, ReviewProposalSchema,
  type RunStore, type ContextWorkspace, type AnalysisRun,
} from '@canonical/contracts';
import { emptyContext, importContext, proposeContext, reviewContext, ContextError } from '../../../packages/runner/src/business-context.ts';

type Params = { id: string; proposalId?: string };

export async function loadContextWorkspace(store: RunStore, run: AnalysisRun): Promise<ContextWorkspace> {
  const workspace = await store.context?.get(run.id) ?? emptyContext(run.id);
  if (!store.context?.provenance || !workspace.approvals.length) return workspace;
  // SurrealDB resolves source citations through native relations. The memory
  // implementation uses the same immutable approval snapshots without a graph DB.
  const approvals = (await Promise.all(run.requirements.map(rule => store.context!.provenance!(run.id, rule.id)))).flat();
  return { ...workspace, approvals };
}

export function registerContextRoutes(app: FastifyInstance, store: RunStore) {
  // Serialize mutations per run in this process. The store also uses atomic CAS
  // so another backend process cannot silently overwrite an approval.
  const pending = new Map<string, Promise<unknown>>();
  async function serialize<T>(id: string, action: () => Promise<T>): Promise<T> {
    const prior = pending.get(id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(action);
    pending.set(id, next);
    try { return await next; } finally { if (pending.get(id) === next) pending.delete(id); }
  }

  app.get<{ Params: Params }>('/api/runs/:id/business-context', async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (!store.context) return reply.code(503).send({ error: 'Context storage is not configured.' });
    return loadContextWorkspace(store, run);
  });

  function mutation(
    path: string,
    apply: (workspace: ContextWorkspace, run: AnalysisRun, body: unknown, params: Params) => ContextWorkspace,
    status: number,
  ) {
    app.post<{ Params: Params }>(path, { bodyLimit: 512 * 1024 }, async (request, reply) => {
      try {
        return await serialize(request.params.id, async () => {
          const run = await store.get(request.params.id);
          if (!run) return reply.code(404).send({ error: 'Run not found' });
          if (!store.context) return reply.code(503).send({ error: 'Context storage is not configured.' });
          if (run.status !== 'completed' && run.status !== 'error') throw new ContextError('Wait until this analysis finishes before reviewing its context.', 409);
          const workspace = await store.context.get(run.id) ?? emptyContext(run.id);
          const updated = apply(workspace, run, request.body, request.params);
          if (updated.revision === workspace.revision) return reply.code(200).send(updated);
          if (!await store.context.save(updated, workspace.revision)) throw new ContextError('This context changed in another session. Refresh and review the latest version.', 409);
          return reply.code(status).send(await loadContextWorkspace(store, run));
        });
      } catch (error) {
        if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid context request. Check required fields and input limits.' });
        if (error instanceof ContextError) return reply.code(error.statusCode).send({ error: error.message });
        throw error;
      }
    });
  }
  mutation('/api/runs/:id/business-context/sources', (workspace, _run, body) => importContext(workspace, ContextImportSchema.parse(body)), 201);
  mutation('/api/runs/:id/business-context/proposals', (workspace, run, body) => proposeContext(workspace, run, CreateProposalSchema.parse(body)), 201);
  mutation('/api/runs/:id/business-context/proposals/:proposalId/review', (workspace, run, body, params) => reviewContext(workspace, run, params.proposalId!, ReviewProposalSchema.parse(body)), 200);
  return async () => { await Promise.allSettled([...pending.values()]); };
}

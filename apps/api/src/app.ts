import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { RunSchema, StartRunSchema, type RunStore } from '@canonical/contracts';
import { createRun } from '@canonical/demo';
import { createEvaluator, executeRun, exportContext, type Evaluator } from '@canonical/runner';
import type { DaytonaConfig } from '@canonical/integrations/daytona';

interface AppOptions {
  store: RunStore;
  daytona?: DaytonaConfig;
  evaluate?: Evaluator;
}

export function buildApp({ store, daytona, evaluate }: AppOptions) {
  const app = Fastify({ logger: true, bodyLimit: 16_384 });
  let busy = false;
  let activeJob: Promise<unknown> | undefined;
  const importing = new Set<string>();

  app.get('/api/health', async () => ({
    status: 'ok', storage: store.kind,
    executionModes: daytona?.apiKey ? ['local', 'daytona'] : ['local'],
  }));

  app.get('/api/runs', async () => ({ runs: await store.list() }));

  // CLI/CI reports enter the same history as interactive runs. Import only terminal
  // snapshots; this endpoint never executes repository code or accepts shell input.
  app.post('/api/runs/import', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const parsed = RunSchema.safeParse(request.body);
    if (!parsed.success || !['completed', 'error'].includes(parsed.data.status)) {
      return reply.code(400).send({ error: 'Expected a valid completed or error analysis report.' });
    }
    const run = parsed.data;
    if (importing.has(run.id)) return reply.code(409).send({ error: 'A run with this ID already exists or is being imported.' });
    importing.add(run.id);
    try {
      if (await store.get(run.id)) return reply.code(409).send({ error: 'A run with this ID already exists.' });
      await store.save(run);
      return reply.code(201).send(run);
    } finally {
      importing.delete(run.id);
    }
  });

  app.post('/api/runs', async (request, reply) => {
    const parsed = StartRunSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Expected execution local/daytona and scenario pricing-cache.' });
    if (parsed.data.execution === 'daytona' && !daytona?.apiKey) {
      return reply.code(503).send({ error: 'Set DAYTONA_API_KEY on the backend to enable Daytona.' });
    }
    if (busy) return reply.code(409).send({ error: 'An analysis is already running. Wait for it to finish.' });
    busy = true;
    const run = createRun(randomUUID(), parsed.data.execution);
    try {
      await store.save(run);
      const response = structuredClone(run);
      activeJob = executeRun(run, store, evaluate ?? createEvaluator(run, daytona))
        .catch(() => app.log.error({ runId: run.id }, 'Could not persist analysis; inspect the configured store'))
        .finally(() => { busy = false; });
      return reply.code(202).send(response);
    } catch (error) {
      busy = false;
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/context', async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return reply.type('text/markdown; charset=utf-8')
      .header('content-disposition', 'attachment; filename="canonical-context.md"')
      .send(exportContext(run));
  });

  app.setErrorHandler((error, request, reply) => {
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    if (status === 400 || status === 413 || status === 415) {
      return reply.code(status).send({ error: 'Invalid request body or content type.' });
    }
    app.log.error({ requestId: request.id }, 'Request failed; inspect backend configuration');
    reply.code(500).send({ error: 'Backend request failed. Check configuration and retry.' });
  });
  app.addHook('onClose', async () => {
    await activeJob;
    await store.close();
  });
  return app;
}

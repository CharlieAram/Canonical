import type { FastifyInstance } from 'fastify';
import { RunSchema, type RunStore } from '@canonical/contracts';

const GENERIC_ERROR = { error: 'Live updates are temporarily unavailable. Reconnect or refresh to resync.' };

// Raw SSE response follows Fastify's reply.hijack API. preClose is necessary:
// onClose alone runs after the server has waited for open response streams.
export function registerLiveRoutes(app: FastifyInstance, store: RunStore) {
  const connections = new Set<() => Promise<void>>();
  let shuttingDown = false;
  async function close() {
    shuttingDown = true;
    await Promise.all([...connections].map(cleanup => cleanup()));
  }
  app.addHook('preClose', close);

  app.get('/api/events', async (request, reply) => {
    if (shuttingDown) return reply.code(503).send(GENERIC_ERROR);
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    let stopped = false;
    let ready = false;
    let dirty = true;
    let lastSnapshot: string | undefined;
    let unsubscribe: (() => Promise<void>) | undefined;
    let setup = Promise.resolve();
    let refresh: Promise<void> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let resync: ReturnType<typeof setInterval> | undefined;

    function write(frame: string) {
      if (stopped || response.destroyed || response.writableEnded) return;
      try { response.write(frame); } catch { void cleanup(); }
    }
    function sendError() { write(`event: error\ndata: ${JSON.stringify(GENERIC_ERROR)}\n\n`); }

    function changed() {
      dirty = true;
      if (stopped || !ready || refresh || response.writableNeedDrain) return;
      // Defer one microtask to coalesce synchronous writes before reading the store.
      refresh = Promise.resolve().then(async () => {
        while (dirty && !stopped && !response.writableNeedDrain) {
          dirty = false;
          try {
            const snapshot = JSON.stringify({ runs: RunSchema.array().parse(await store.list()) });
            if (!stopped && snapshot !== lastSnapshot) {
              write(`event: runs\ndata: ${snapshot}\n\n`);
              lastSnapshot = snapshot;
            }
          } catch {
            if (!stopped) sendError();
          }
        }
      }).catch(() => { if (!stopped) sendError(); }).finally(() => {
        refresh = undefined;
        if (dirty && !stopped && !response.writableNeedDrain) changed();
      });
    }

    function cleanup(): Promise<void> {
      if (cleanupPromise) return cleanupPromise;
      stopped = true;
      clearInterval(heartbeat); clearInterval(resync);
      response.off('drain', changed);
      response.off('close', disconnected);
      request.raw.off('aborted', disconnected);
      if (!response.destroyed && !response.writableEnded) response.end();
      cleanupPromise = (async () => {
        await setup;
        try { await unsubscribe?.(); } catch { /* Connection may already be gone. */ }
        await refresh;
      })().finally(() => { connections.delete(cleanup); });
      return cleanupPromise;
    }
    function disconnected() { void cleanup(); }
    connections.add(cleanup);
    response.on('close', disconnected);
    response.on('error', disconnected);
    response.on('drain', changed);
    request.raw.on('aborted', disconnected);

    setup = (async () => {
      try { unsubscribe = await store.subscribe?.(changed); }
      catch { if (!stopped) sendError(); }
      if (stopped) return;
      ready = true;
      changed();
      heartbeat = setInterval(() => {
        if (!response.writableNeedDrain) write(': heartbeat\n\n');
      }, 15_000);
      // Also repairs missed notifications or temporary DB subscription failures.
      // Identical snapshots are suppressed, including when only heartbeats are due.
      resync = setInterval(changed, 5_000);
      heartbeat.unref(); resync.unref();
    })();
    await setup;
  });
  return close;
}

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { RunSchema, type AnalysisRun, type RunStore } from '@canonical/contracts';
import { createRun } from '@canonical/demo';
import { createMemoryStore } from '../apps/api/src/store.ts';
import { registerLiveRoutes } from '../apps/api/src/live-routes.ts';

async function server(t: TestContext, store: RunStore) {
  const app = Fastify({ logger: false });
  registerLiveRoutes(app, store);
  app.addHook('onClose', async () => { await store.close(); });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  return { app, address };
}

async function stream(t: TestContext, address: string) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${address}/api/events`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9_000)]) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  async function next(): Promise<{ event: string; data: unknown }> {
    for (;;) {
      const boundary = pending.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (event && data) return { event, data: JSON.parse(data) };
        continue;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream closed before the expected event');
      pending += decoder.decode(chunk.value, { stream: true });
    }
  }
  async function runs() {
    const event = await next();
    assert.equal(event.event, 'runs');
    return RunSchema.array().parse((event.data as { runs: unknown }).runs);
  }
  return { next, runs, abort: () => controller.abort(), reader };
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.ok(predicate(), 'Expected cleanup to complete');
}

test('SSE discovers external saves and queued/running/completed transitions, then unsubscribes on disconnect', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  let subscriptions = 0;
  let unsubscriptions = 0;
  const store: RunStore = {
    ...memory,
    async subscribe(onChange) {
      subscriptions++;
      const stop = await memory.subscribe!(onChange);
      return async () => { unsubscriptions++; await stop(); };
    },
  };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  assert.deepEqual(await live.runs(), []);
  assert.equal(subscriptions, 1);
  const run = createRun('external-ci-write', 'local');
  for (const status of ['queued', 'running', 'completed'] as const) {
    run.status = status; run.stage = status;
    // Simulates another producer writing directly to storage, outside HTTP handlers.
    await store.save(run);
    const received = await live.runs();
    assert.equal(received[0]?.id, run.id);
    assert.equal(received[0]?.status, status);
  }
  live.abort();
  await eventually(() => unsubscriptions === 1);
});

test('SSE subscribes before reading, serializes snapshots, and reconciles changes during the initial fetch', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  const run = createRun('changed-during-read', 'local');
  await memory.save(run);
  let subscribed = false;
  let reading = 0;
  let maximumReading = 0;
  let calls = 0;
  let release!: () => void;
  let began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  t.after(() => release());
  const store: RunStore = {
    ...memory,
    async subscribe(callback) { subscribed = true; return memory.subscribe!(callback); },
    async list() {
      assert.equal(subscribed, true);
      reading++; maximumReading = Math.max(maximumReading, reading);
      const snapshot = await memory.list();
      if (++calls === 1) { began(); await gate; }
      reading--; return snapshot;
    },
  };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  await started;
  for (const status of ['running', 'completed'] as const) {
    run.status = status; await store.save(run);
  }
  release();
  assert.equal((await live.runs())[0]?.status, 'queued');
  assert.equal((await live.runs())[0]?.status, 'completed');
  assert.equal(maximumReading, 1);
  assert.equal(calls, 2, 'A burst while reading should coalesce into one refresh');
});

test('SSE reports generic failures without leaking store secrets, then recovers to a validated snapshot', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  let fail = true;
  const store: RunStore = { ...memory, async list() {
    if (fail) throw new Error('secret-database-credential');
    return memory.list();
  } };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  const error = await live.next();
  assert.equal(error.event, 'error');
  assert.match(JSON.stringify(error.data), /Reconnect or refresh/);
  assert.doesNotMatch(JSON.stringify(error.data), /secret-database-credential/);
  fail = false;
  await store.save(createRun('recovered-write', 'local'));
  assert.equal((await live.runs())[0]?.id, 'recovered-write');
});

test('SSE rejects invalid stored report shapes instead of emitting unvalidated run data', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  const store: RunStore = { ...memory, async list() { return [{ secret: 'private-record' }] as unknown as AnalysisRun[]; } };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  const error = await live.next();
  assert.equal(error.event, 'error');
  assert.doesNotMatch(JSON.stringify(error.data), /private-record/);
});

test('app shutdown closes connected SSE clients and kills each subscription exactly once', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  let stopped = 0;
  const store: RunStore = { ...memory, async subscribe(callback) {
    const stop = await memory.subscribe!(callback);
    return async () => { stopped++; await stop(); };
  } };
  const { app, address } = await server(t, store);
  const first = await stream(t, address);
  const second = await stream(t, address);
  await first.runs(); await second.runs();
  await app.close();
  assert.equal(stopped, 2);
  assert.equal((await first.reader.read()).done, true);
  assert.equal((await second.reader.read()).done, true);
});

test('disconnect during subscription setup cleans up the subscription when it arrives', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  let stopped = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const store: RunStore = { ...memory, async subscribe(callback) {
    await gate;
    const stop = await memory.subscribe!(callback);
    return async () => { stopped++; await stop(); };
  } };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  live.abort();
  release();
  await eventually(() => stopped === 1);
});

test('stores without notifications still refresh authoritative state periodically', { timeout: 10_000 }, async t => {
  const memory = createMemoryStore();
  const store: RunStore = { ...memory, subscribe: undefined };
  const { address } = await server(t, store);
  const live = await stream(t, address);
  assert.deepEqual(await live.runs(), []);
  await memory.save(createRun('fallback-discovery', 'local'));
  assert.equal((await live.runs())[0]?.id, 'fallback-discovery');
});

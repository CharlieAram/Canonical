import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RunSchema, type AnalysisRun, type RunStore } from '@canonical/contracts';
import { createRun, createUiFixture } from '@canonical/demo';
import { buildApp } from '../apps/api/src/app.ts';
import { createMemoryStore } from '../apps/api/src/store.ts';

async function waitForRun(store: RunStore, id: string): Promise<AnalysisRun> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = await store.get(id);
    if (run && ['completed', 'error'].includes(run.status)) return run;
    await delay(10);
  }
  throw new Error(`Run ${id} did not reach a terminal state`);
}

test('HTTP vertical slice executes the local fixture and exports reviewable evidence', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store });
  t.after(() => app.close());
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok', storage: 'memory', executionModes: ['local'] });

  const started = await app.inject({ method: 'POST', url: '/api/runs', payload: { execution: 'local', scenario: 'pricing-cache' } });
  assert.equal(started.statusCode, 202);
  const queued = RunSchema.parse(started.json());
  assert.equal(queued.status, 'queued');
  assert.deepEqual(queued.results, []);
  const completed = await waitForRun(store, queued.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.results[1].checks.find(check => check.requirementId === 'account-price')?.status, 'failed');

  const fetched = await app.inject({ method: 'GET', url: `/api/runs/${queued.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(RunSchema.parse(fetched.json()), completed);
  const list = await app.inject({ method: 'GET', url: '/api/runs' });
  assert.equal(list.json().runs[0].id, queued.id);
  const context = await app.inject({ method: 'GET', url: `/api/runs/${queued.id}/context` });
  assert.equal(context.statusCode, 200);
  assert.match(context.headers['content-type'] ?? '', /text\/markdown/);
  assert.match(context.headers['content-disposition'] ?? '', /attachment; filename="canonical-context\.md"/);
  assert.match(context.body, /FAILED Account-specific pricing/);
  assert.match(context.body, /Source: built-in pricing fixture/);
});

test('HTTP API rejects unsupported input and unavailable providers before creating work', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store });
  t.after(() => app.close());
  for (const payload of [{ execution: 'shell' }, { scenario: 'arbitrary-repo' }, { command: 'echo unsafe' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/runs', payload });
    assert.equal(response.statusCode, 400);
  }
  const malformed = await app.inject({ method: 'POST', url: '/api/runs', headers: { 'content-type': 'application/json' }, payload: '{' });
  assert.equal(malformed.statusCode, 400);
  const oversized = await app.inject({ method: 'POST', url: '/api/runs', payload: { extra: 'x'.repeat(17_000) } });
  assert.equal(oversized.statusCode, 413);
  const unsupported = await app.inject({ method: 'POST', url: '/api/runs', headers: { 'content-type': 'application/octet-stream' }, payload: 'unsupported' });
  assert.equal(unsupported.statusCode, 415);
  const unavailable = await app.inject({ method: 'POST', url: '/api/runs', payload: { execution: 'daytona' } });
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(await store.list(), []);
  for (const url of ['/api/runs/absent', '/api/runs/absent/context']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404);
  }
});

test('one active analysis blocks another until the original run finishes', async t => {
  const store = createMemoryStore();
  const fixture = createUiFixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = buildApp({ store, evaluate: async variant => {
    await gate;
    return fixture.results.find(result => result.variant === variant)!;
  } });
  t.after(async () => { release(); await app.close(); });
  const first = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
  assert.equal(first.statusCode, 202);
  const second = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
  assert.equal(second.statusCode, 409);
  assert.equal((await store.list()).length, 1);
  release();
  assert.equal((await waitForRun(store, first.json().id)).status, 'completed');
  const third = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
  assert.equal(third.statusCode, 202);
});

test('a failed analysis remains readable through HTTP with partial evidence', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store, evaluate: async variant => {
    if (variant === 'candidate') throw new Error('secret-provider-token');
    return createUiFixture().results[0];
  } });
  t.after(() => app.close());
  const start = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
  const run = await waitForRun(store, start.json().id);
  assert.equal(run.status, 'error');
  assert.equal(run.results.length, 1);
  const fetched = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().status, 'error');
  assert.doesNotMatch(fetched.body, /secret-provider-token/);
});

test('memory persistence isolates saved and returned snapshots from mutation', async () => {
  const store = createMemoryStore();
  const run = createRun('isolated-memory-run', 'local');
  await store.save(run);
  run.graph.nodes[0].label = 'unsaved mutation';
  const restored = await store.get(run.id);
  assert.equal(restored?.graph.nodes[0].label, 'Account');
  restored!.graph.nodes.length = 0;
  const listed = await store.list();
  assert.equal(listed[0].graph.nodes.length, 5);
  listed[0].status = 'error';
  assert.equal((await store.get(run.id))?.status, 'queued');
  await store.close();
});

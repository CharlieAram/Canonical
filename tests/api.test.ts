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

test('report import preserves terminal evidence and IDs without rerunning checks', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store, evaluate: async () => { throw new Error('Imports must not execute'); } });
  t.after(() => app.close());
  for (const status of ['completed', 'error'] as const) {
    const report = createUiFixture();
    report.id = `imported-${status}`;
    report.status = status;
    if (status === 'error') {
      report.results = report.results.slice(0, 1);
      report.error = 'Candidate execution failed';
    }
    // Reports can exceed the small interactive-start request limit.
    report.stage = 'CI report '.repeat(2_000);
    const imported = await app.inject({ method: 'POST', url: '/api/runs/import', payload: report });
    assert.equal(imported.statusCode, 201);
    assert.deepEqual(imported.json(), report);
    const fetched = await app.inject({ method: 'GET', url: `/api/runs/${report.id}` });
    assert.deepEqual(fetched.json(), report);
    assert.equal((await app.inject({ method: 'GET', url: `/api/runs/${report.id}/context` })).statusCode, 200);
  }
  assert.equal((await store.list()).length, 2);
});

test('report import rejects invalid, nonterminal and oversized data without persistence', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store });
  t.after(() => app.close());
  const report = createUiFixture();
  for (const payload of [{}, { ...report, status: 'running' }, { ...report, status: 'queued' },
    { ...report, results: [{ variant: 'candidate' }] }, { ...report, source: { kind: 'arbitrary' } }]) {
    const response = await app.inject({ method: 'POST', url: '/api/runs/import', payload });
    assert.equal(response.statusCode, 400);
  }
  const oversized = await app.inject({ method: 'POST', url: '/api/runs/import',
    payload: { ...report, stage: 'x'.repeat(1024 * 1024) } });
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(await store.list(), []);
});

test('Git report import retains immutable revision provenance and rejects malformed commit IDs', async t => {
  const store = createMemoryStore();
  const app = buildApp({ store });
  t.after(() => app.close());
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const report: AnalysisRun = {
    ...createUiFixture(), id: 'imported-git-report', execution: 'daytona',
    source: {
      kind: 'git', name: 'CanonicalTestbed', baseline: 'main', candidate: 'demo/product-cache',
      baseSha, headSha, changedFiles: ['src/pricing.mjs'], policyPath: '.canonical/business.json',
    },
  };
  report.graph.provenance = 'declared-policy';
  report.results.forEach(result => { result.commitSha = result.variant === 'baseline' ? baseSha : headSha; });
  const imported = await app.inject({ method: 'POST', url: '/api/runs/import', payload: report });
  assert.equal(imported.statusCode, 201);
  assert.deepEqual(RunSchema.parse(imported.json()), report);
  const fetched = await app.inject({ method: 'GET', url: `/api/runs/${report.id}` });
  assert.deepEqual(fetched.json(), report);
  for (const changes of [{ baseSha: 'main' }, { headSha: 'bbbbbbb' }, { policyPath: 'candidate-policy.json' }]) {
    const invalid = await app.inject({ method: 'POST', url: '/api/runs/import', payload: {
      ...report, id: 'invalid-git-report', source: { ...report.source, ...changes },
    } });
    assert.equal(invalid.statusCode, 400);
  }
  assert.equal((await store.list()).length, 1);
});

test('duplicate imports cannot overwrite existing or actively executing reports', async t => {
  const store = createMemoryStore();
  const fixture = createUiFixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = buildApp({ store, evaluate: async variant => {
    await gate;
    return fixture.results.find(result => result.variant === variant)!;
  } });
  t.after(async () => { release(); await app.close(); });
  const started = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
  const activeId = started.json().id;
  const collision = await app.inject({ method: 'POST', url: '/api/runs/import',
    payload: { ...fixture, id: activeId } });
  assert.equal(collision.statusCode, 409);
  assert.equal((await store.get(activeId))?.status, 'running');
  assert.deepEqual((await store.get(activeId))?.results, []);
  const responses = await Promise.all([1, 2].map(() => app.inject({
    method: 'POST', url: '/api/runs/import', payload: fixture,
  })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  assert.deepEqual(await store.get(fixture.id), fixture);
});

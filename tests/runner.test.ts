import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { StartRunSchema, type AnalysisRun, type RunStore } from '@canonical/contracts';
import { createRun, createUiFixture } from '@canonical/demo';
import { evaluateLocally, executeRun, exportContext } from '@canonical/runner';

function recordingStore() {
  const snapshots: AnalysisRun[] = [];
  const store: RunStore = {
    kind: 'memory',
    async save(run) { snapshots.push(structuredClone(run)); },
    async get(id) { return snapshots.findLast(run => run.id === id); },
    async list() { return snapshots.slice(-1); },
    async close() {},
  };
  return { store, snapshots };
}

test('run requests allow only the supported execution mode and built-in scenario', () => {
  assert.deepEqual(StartRunSchema.parse({}), { execution: 'local', scenario: 'pricing-cache' });
  assert.equal(StartRunSchema.safeParse({ execution: 'shell' }).success, false);
  assert.equal(StartRunSchema.safeParse({ scenario: 'https://example.com/repo' }).success, false);
  assert.equal(StartRunSchema.safeParse({ command: 'echo unsafe' }).success, false);
});

test('the real pricing harness exposes the account leak and measures executed work', async () => {
  const [baseline, candidate] = await Promise.all([
    evaluateLocally('baseline'), evaluateLocally('candidate'),
  ]);
  assert.ok(baseline.checks.every(check => check.status === 'passed'));
  const failures = candidate.checks.filter(check => check.status === 'failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].requirementId, 'account-price');
  assert.equal(failures[0].expected, 'Alpha: $80; Beta: $100');
  assert.equal(failures[0].actual, 'Alpha: $80; Beta: $80');
  assert.equal(baseline.benchmark.samples.length, 20);
  assert.equal(candidate.benchmark.samples.length, 20);
  assert.equal(baseline.benchmark.upstreamCalls, 23);
  assert.equal(candidate.benchmark.upstreamCalls, 1);
  // Validate work counts rather than noisy wall-clock speed ratios.
  assert.notEqual(baseline.runtime, 'UI fixture');
});

test('an evaluator failure preserves baseline evidence and hides provider secrets', async () => {
  const { store, snapshots } = recordingStore();
  const baseline = createUiFixture().results[0];
  const run = await executeRun(createRun(randomUUID(), 'local'), store, async variant => {
    if (variant === 'candidate') throw new Error('Authorization: Bearer confidential-provider-key');
    return baseline;
  });
  assert.equal(run.status, 'error');
  assert.deepEqual(run.results, [baseline]);
  assert.ok(run.error);
  assert.doesNotMatch(run.error, /confidential|Bearer|Authorization/);
  assert.equal(snapshots.at(-1)?.status, 'error');
  assert.ok(snapshots.some(snapshot => snapshot.status === 'running' && snapshot.results.length === 1));
});

test('a successful execution marks only directly evidenced failed concepts', async () => {
  const { store } = recordingStore();
  const fixture = createUiFixture();
  const run = await executeRun(createRun(randomUUID(), 'local'), store, async variant => fixture.results.find(result => result.variant === variant)!);
  assert.equal(run.status, 'completed');
  assert.equal(run.results.length, 2);
  assert.equal(run.graph.nodes.find(node => node.id === 'quote')?.impact, 'failed');
  assert.equal(run.graph.nodes.find(node => node.id === 'cache')?.impact, 'failed');
  assert.equal(run.graph.nodes.find(node => node.id === 'order')?.impact, 'potential');
});

test('incomplete, duplicate, and wrong-variant harness evidence cannot complete a run', async t => {
  const baseline = createUiFixture().results[0];
  const invalid = [
    { name: 'missing approved check', result: { ...baseline, checks: baseline.checks.slice(1) } },
    { name: 'duplicate approved check', result: { ...baseline, checks: [baseline.checks[0], baseline.checks[0], baseline.checks[2]] } },
    { name: 'wrong variant', result: { ...baseline, variant: 'candidate' as const } },
  ];
  for (const { name, result } of invalid) {
    await t.test(name, async () => {
      const { store } = recordingStore();
      const run = await executeRun(createRun(randomUUID(), 'local'), store, async () => result);
      assert.equal(run.status, 'error');
      assert.equal(run.results.length, 0);
      assert.match(run.error ?? '', /Harness/);
    });
  }
});

test('context export ties approved requirements to failed evidence and fixture provenance', () => {
  const context = exportContext(createUiFixture());
  assert.match(context, /A quote must use the requesting account’s price/);
  assert.match(context, /FAILED Account-specific pricing: expected Alpha: \$80; Beta: \$100; observed Alpha: \$80; Beta: \$80/);
  assert.match(context, /Source: built-in pricing fixture/);
  assert.match(context, /No Git revision or AI extraction is claimed/);
  assert.match(context, /simulated upstream/);
  assert.match(context, /node checks\/pricing\.mjs candidate/);
});

test('Git execution requires evidence to identify the exact requested commit for each variant', async t => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const gitRun = () => {
    const run = createRun(randomUUID(), 'daytona');
    run.source = {
      kind: 'git', name: 'CanonicalTestbed', baseline: 'main', candidate: 'demo/product-cache',
      baseSha, headSha, changedFiles: ['src/pricing.mjs'], policyPath: '.canonical/business.json',
    };
    run.graph.provenance = 'declared-policy';
    return run;
  };
  for (const invalidVariant of ['baseline', 'candidate'] as const) {
    for (const invalidSha of [undefined, 'c'.repeat(40)]) {
      await t.test(`${invalidVariant} ${invalidSha ? 'mismatched' : 'missing'} SHA rejects evidence`, async () => {
        const fixture = createUiFixture();
        const { store } = recordingStore();
        const run = await executeRun(gitRun(), store, async variant => ({
          ...fixture.results.find(result => result.variant === variant)!,
          commitSha: variant === invalidVariant ? invalidSha : variant === 'baseline' ? baseSha : headSha,
        }));
        assert.equal(run.status, 'error');
        assert.match(run.error ?? '', /wrong Git commit/);
        assert.equal(run.results.length, invalidVariant === 'baseline' ? 0 : 1);
        if (invalidVariant === 'candidate') assert.equal(run.results[0].commitSha, baseSha);
        assert.equal((await store.get(run.id))?.status, 'error');
      });
    }
  }
  await t.test('exact commit evidence completes a review and retains both identifiers', async () => {
    const fixture = createUiFixture();
    const { store } = recordingStore();
    const run = await executeRun(gitRun(), store, async variant => ({
      ...fixture.results.find(result => result.variant === variant)!,
      commitSha: variant === 'baseline' ? baseSha : headSha,
    }));
    assert.equal(run.status, 'completed');
    assert.deepEqual(run.results.map(result => result.commitSha), [baseSha, headSha]);
    assert.equal(run.results[1].checks[0].status, 'failed');
  });
});

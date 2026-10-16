import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunSchema, type AnalysisRun, type LayerDiff, type RunStore, type RevisionSource } from '@canonical/contracts';
import { createRun, createUiFixture } from '@canonical/demo';
import { executeRepositoryReview, type LayerExtractors } from '../packages/runner/src/review-pipeline.ts';
import type { PreparedRepositoryComparison } from '../packages/runner/src/repository.ts';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
function gitRun() {
  const run = createRun('pipeline-test', 'daytona');
  run.source = { kind: 'git', name: 'Test repository', baseline: 'main', candidate: 'change', baseSha, headSha,
    changedFiles: ['src/pricing.mjs'], policyPath: '.canonical/business.json' };
  run.graph.provenance = 'declared-policy';
  return run;
}
function comparison(): PreparedRepositoryComparison & { sources: { baseline: RevisionSource; candidate: RevisionSource } } {
  const run = gitRun();
  return {
    baseSha, headSha, repositoryName: 'Test repository', changedFiles: ['src/pricing.mjs'],
    policy: { version: 1, harness: 'pricing-v1', requirements: run.requirements, graph: run.graph },
    bundlePath: '/unused/injected-test.bundle', dispose: async () => {},
    sources: {
      baseline: { sha: baseSha, path: 'src/pricing.mjs', content: 'export function createQuoteService() {}' },
      candidate: { sha: headSha, path: 'src/pricing.mjs', content: 'export function createQuoteService() { const cache = new Map(); }' },
    },
  };
}
const layer = (): LayerDiff => ({
  provenance: 'static-analysis', before: { nodes: [], edges: [] }, after: { nodes: [], edges: [] },
  changes: [], summary: 'Injected test extraction completed', limitations: ['Test double; no source-analysis claim.'],
});
const extractors = (): LayerExtractors => ({ method: 'static-analysis', objects: layer, logic: layer });
function evidence(variant: 'baseline' | 'candidate', allPass = false) {
  const result = structuredClone(createUiFixture().results.find(item => item.variant === variant)!);
  result.commitSha = variant === 'baseline' ? baseSha : headSha;
  if (allPass) result.checks.forEach(check => { check.status = 'passed'; check.actual = check.expected; });
  return result;
}
function recordingStore() {
  const snapshots: AnalysisRun[] = [];
  const store: RunStore = {
    kind: 'memory',
    async save(run) { snapshots.push(structuredClone(RunSchema.parse(run))); },
    async get(id) { return structuredClone(snapshots.findLast(run => run.id === id)); },
    async list() { return structuredClone(snapshots.slice(-1)); },
    async close() {},
  };
  return { store, snapshots };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('repository review persists queued tasks, concurrent extraction, and layers before checks finish', async t => {
  const { store, snapshots } = recordingStore();
  const objectsStarted = gate();
  const logicStarted = gate();
  const releaseObjects = gate();
  const releaseLogic = gate();
  const checksStarted = gate();
  const releaseChecks = gate();
  t.after(() => { releaseObjects.resolve(); releaseLogic.resolve(); releaseChecks.resolve(); });
  const supplied = comparison();
  const task = executeRepositoryReview(gitRun(), store, supplied, {
    extractors: {
      method: 'static-analysis',
      async objects(before, after) {
        assert.deepEqual(before, supplied.sources.baseline);
        assert.deepEqual(after, supplied.sources.candidate);
        objectsStarted.resolve(); await releaseObjects.promise; return layer();
      },
      async logic() { logicStarted.resolve(); await releaseLogic.promise; return layer(); },
    },
    evaluate: async variant => { checksStarted.resolve(); await releaseChecks.promise; return evidence(variant); },
    trigger: { kind: 'github', url: 'https://github.com/example/repository/actions/runs/123', attempt: '1' },
  });
  await Promise.all([objectsStarted.promise, logicStarted.promise]);
  assert.equal(snapshots[0].status, 'queued');
  assert.ok(snapshots[0].review!.agents.every(agent => agent.status === 'queued'));
  const extracting = snapshots.at(-1)!;
  assert.ok(extracting.review!.agents.filter(agent => agent.id !== 'business-checks').every(agent => agent.status === 'running'));
  assert.equal(extracting.review!.agents.find(agent => agent.id === 'business-checks')?.status, 'queued');
  assert.ok(extracting.review!.billOfBusiness.every(entry => entry.status === 'pending'));
  releaseObjects.resolve(); releaseLogic.resolve();
  await checksStarted.promise;
  const checking = snapshots.at(-1)!;
  assert.deepEqual(checking.review!.objects, layer());
  assert.deepEqual(checking.review!.logic, layer());
  assert.equal(checking.results.length, 0);
  assert.ok(checking.review!.billOfBusiness.every(entry => entry.status === 'pending'));
  releaseChecks.resolve();
  const finished = await task;
  assert.equal(finished.status, 'completed');
  assert.equal(finished.review!.trigger?.kind, 'github');
  assert.equal(finished.review!.billOfBusiness.find(entry => entry.id === 'account-price')?.status, 'failed');
  assert.deepEqual(snapshots.map(snapshot => snapshot.review!.sequence), snapshots.map((_, index) => index + 1));
  assert.deepEqual(finished.review!.events.map(event => event.sequence), snapshots.map((_, index) => index + 1));
  assert.ok(finished.review!.agents.every(agent => agent.status === 'completed'));
});

test('business requirements stay pending after baseline evidence and become passed only after candidate evidence', async t => {
  const { store, snapshots } = recordingStore();
  const candidateStarted = gate();
  const releaseCandidate = gate();
  t.after(() => releaseCandidate.resolve());
  const task = executeRepositoryReview(gitRun(), store, comparison(), {
    extractors: extractors(), evaluate: async variant => {
      if (variant === 'candidate') { candidateStarted.resolve(); await releaseCandidate.promise; }
      return evidence(variant, true);
    },
  });
  await candidateStarted.promise;
  const partial = snapshots.at(-1)!;
  assert.equal(partial.results.length, 1);
  assert.ok(partial.review!.billOfBusiness.every(entry => entry.baselineStatus === 'passed' && entry.candidateStatus === 'pending' && entry.status === 'pending'));
  releaseCandidate.resolve();
  const finished = await task;
  assert.ok(finished.review!.billOfBusiness.every(entry => entry.status === 'passed' && entry.baselineStatus === 'passed' && entry.candidateStatus === 'passed'));
  assert.ok(finished.review!.billOfBusiness.every(entry => entry.evidence.length === 2));
  assert.deepEqual(finished.review!.billOfBusiness[0].evidence.map(item => item.commitSha), [baseSha, headSha]);
});

test('missing required candidate evidence yields error rather than green requirements', async () => {
  const { store } = recordingStore();
  const finished = await executeRepositoryReview(gitRun(), store, comparison(), {
    extractors: extractors(), evaluate: async variant => {
      const result = evidence(variant, true);
      if (variant === 'candidate') result.checks.pop();
      return result;
    },
  });
  assert.equal(finished.status, 'error');
  assert.equal(finished.results.length, 1);
  assert.equal(finished.review!.agents.find(agent => agent.id === 'business-checks')?.status, 'error');
  assert.ok(finished.review!.billOfBusiness.every(entry => entry.status === 'error' && entry.baselineStatus === 'passed' && entry.candidateStatus === 'error'));
});

test('extraction failure retains independent layer and executed checks but leaves the review incomplete', async () => {
  const { store, snapshots } = recordingStore();
  const finished = await executeRepositoryReview(gitRun(), store, comparison(), {
    extractors: { ...extractors(), objects: async () => { throw new Error('secret-provider-token'); } },
    evaluate: async variant => evidence(variant, true),
  });
  assert.equal(finished.status, 'error');
  assert.equal(finished.results.length, 2);
  assert.equal(finished.review!.objects, undefined);
  assert.deepEqual(finished.review!.logic, layer());
  assert.equal(finished.review!.agents.find(agent => agent.id === 'objects')?.status, 'error');
  assert.equal(finished.review!.agents.find(agent => agent.id === 'logic')?.status, 'completed');
  assert.equal(finished.review!.agents.find(agent => agent.id === 'business-checks')?.status, 'completed');
  assert.ok(finished.review!.billOfBusiness.every(entry => entry.status === 'passed'));
  assert.doesNotMatch(JSON.stringify(snapshots), /secret-provider-token/);
  assert.ok(snapshots.every(snapshot => snapshot.status !== 'completed'), 'A failed extraction must never publish a completed review snapshot');
  assert.equal(snapshots.at(-1)?.status, 'error');
});

test('malformed extraction output is rejected while genuine business failures remain visible', async () => {
  const { store } = recordingStore();
  const finished = await executeRepositoryReview(gitRun(), store, comparison(), {
    extractors: { ...extractors(), logic: () => ({ ...layer(), provenance: 'unverified-claim' } as unknown as LayerDiff) },
    evaluate: async variant => evidence(variant),
  });
  assert.equal(finished.status, 'error');
  assert.equal(finished.review!.logic, undefined);
  assert.equal(finished.review!.agents.find(agent => agent.id === 'logic')?.status, 'error');
  const pricing = finished.review!.billOfBusiness.find(entry => entry.id === 'account-price')!;
  assert.equal(pricing.status, 'failed');
  assert.equal(pricing.candidateStatus, 'failed');
  assert.match(pricing.evidence.find(item => item.variant === 'candidate')!.actual, /Beta: \$80/);
});

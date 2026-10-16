import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContextWorkspaceSchema, type ContextWorkspace } from '@canonical/contracts';
import { createRun, createUiFixture } from '@canonical/demo';
import { buildApp } from '../apps/api/src/app.ts';
import { createMemoryStore } from '../apps/api/src/store.ts';
import { emptyContext, importContext } from '../packages/runner/src/business-context.ts';

const imported = {
  title: 'Synthetic pricing discussion', kind: 'synthetic',
  text: '[00:12] Maya: Beta pays $100.\n[00:24] Leo: Unreviewed internal note.',
};
const route = (id = 'ui-fixture') => `/api/runs/${id}/business-context`;
function proposed(workspace: ContextWorkspace, changes = {}) {
  return {
    sourceId: workspace.sources[0].id, segmentId: workspace.sources[0].segments[0].id,
    quote: 'Beta pays $100.', requirementId: 'account-price', rationale: 'Supports the existing retail policy.',
    ...changes,
  };
}

test('HTTP transcript workflow preserves executed report and exports only accepted exact quotations', async t => {
  const store = createMemoryStore();
  const run = createUiFixture();
  await store.save(run);
  const app = buildApp({ store });
  t.after(() => app.close());
  const empty = await app.inject({ method: 'GET', url: route() });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().sources, []);
  const source = await app.inject({ method: 'POST', url: `${route()}/sources`, payload: imported });
  assert.equal(source.statusCode, 201);
  let workspace = ContextWorkspaceSchema.parse(source.json());
  const proposal = await app.inject({ method: 'POST', url: `${route()}/proposals`, payload: proposed(workspace) });
  assert.equal(proposal.statusCode, 201);
  workspace = ContextWorkspaceSchema.parse(proposal.json());
  const reviewed = await app.inject({ method: 'POST', url: `${route()}/proposals/${workspace.proposals[0].id}/review`,
    payload: { decision: 'accepted', reviewer: 'Demo reviewer', note: 'Checked the quotation.' } });
  assert.equal(reviewed.statusCode, 200);
  workspace = ContextWorkspaceSchema.parse(reviewed.json());
  assert.equal(workspace.approvals.length, 1);
  const other = await app.inject({ method: 'POST', url: `${route()}/proposals`, payload: proposed(workspace, {
    segmentId: workspace.sources[0].segments[1].id, quote: 'Unreviewed internal note.', requirementId: 'repeat-price',
  }) });
  const rejectedId = other.json().proposals.at(-1).id;
  assert.equal((await app.inject({ method: 'POST', url: `${route()}/proposals/${rejectedId}/review`,
    payload: { decision: 'rejected', reviewer: 'Demo reviewer', note: 'Does not establish a rule.' } })).statusCode, 200);
  assert.deepEqual(await store.get(run.id), run);
  const exported = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/context` });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.body, /Beta pays \$100\./);
  assert.match(exported.body, /Synthetic pricing discussion/);
  assert.match(exported.body, /00:12/);
  assert.doesNotMatch(exported.body, /Unreviewed internal note/);
  assert.match(exported.body, /FAILED Account-specific pricing/);
});

test('HTTP context validates citations, rejects policy rewriting and isolates runs', async t => {
  const store = createMemoryStore();
  await store.save(createUiFixture());
  const second = { ...createUiFixture(), id: 'second-run' };
  await store.save(second);
  const app = buildApp({ store });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: `${route()}/sources`, payload: imported });
  const workspace = ContextWorkspaceSchema.parse(response.json());
  for (const payload of [
    proposed(workspace, { quote: 'Beta pays $80.' }),
    proposed(workspace, { requirementId: 'new-policy' }),
    proposed(workspace, { requirementText: 'All accounts pay the same price.' }),
    proposed(workspace, { conceptIds: [] }),
  ]) {
    assert.equal((await app.inject({ method: 'POST', url: `${route()}/proposals`, payload })).statusCode, 400);
  }
  const foreign = await app.inject({ method: 'POST', url: `${route(second.id)}/proposals`, payload: proposed(workspace) });
  assert.equal(foreign.statusCode, 400);
  assert.deepEqual((await app.inject({ method: 'GET', url: route(second.id) })).json().sources, []);
  const foreignImport = await app.inject({ method: 'POST', url: `${route(second.id)}/sources`, payload: imported });
  assert.equal(foreignImport.statusCode, 201);
  assert.equal(foreignImport.json().sources[0].runId, second.id);
  assert.equal((await app.inject({ method: 'GET', url: route() })).json().sources[0].runId, 'ui-fixture');
  assert.equal((await app.inject({ method: 'POST', url: `${route()}/proposals/absent/review`,
    payload: { decision: 'accepted', reviewer: 'Reviewer' } })).statusCode, 404);
});

test('HTTP context rejects unknown runs, nonterminal writes, invalid imports and oversized bodies', async t => {
  const store = createMemoryStore();
  await store.save(createRun('active', 'local'));
  await store.save(createUiFixture());
  const app = buildApp({ store });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: route('missing') })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${route('missing')}/sources`, payload: imported })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${route('active')}/sources`, payload: imported })).statusCode, 409);
  for (const payload of [{ ...imported, text: '' }, { ...imported, kind: 'unknown' },
    { ...imported, sourceUrl: 'javascript:alert(1)' }, { ...imported, title: '' },
    { ...imported, text: 'x'.repeat(100_001) }]) {
    assert.equal((await app.inject({ method: 'POST', url: `${route()}/sources`, payload })).statusCode, 400);
  }
  const oversized = await app.inject({ method: 'POST', url: `${route()}/sources`, payload: { ...imported, text: 'x'.repeat(512 * 1024) } });
  assert.equal(oversized.statusCode, 413);
  const substantial = await app.inject({ method: 'POST', url: `${route()}/sources`, payload: { ...imported, text: 'x'.repeat(20_000) } });
  assert.equal(substantial.statusCode, 201);
});

test('concurrent imports deduplicate and preserve independent sources without lost updates', async t => {
  const store = createMemoryStore();
  await store.save(createUiFixture());
  const app = buildApp({ store });
  t.after(() => app.close());
  const same = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `${route()}/sources`, payload: imported })));
  assert.deepEqual(same.map(response => response.statusCode).sort(), [200, 201]);
  const distinct = await Promise.all(['One', 'Two'].map(text => app.inject({ method: 'POST', url: `${route()}/sources`,
    payload: { ...imported, text } })));
  assert.deepEqual(distinct.map(response => response.statusCode), [201, 201]);
  const workspace = ContextWorkspaceSchema.parse((await app.inject({ method: 'GET', url: route() })).json());
  assert.equal(workspace.revision, 3);
  assert.equal(workspace.sources.length, 3);
});

test('concurrent approvals allow only one immutable mapping for a requirement', async t => {
  const store = createMemoryStore();
  const run = createUiFixture();
  await store.save(run);
  const app = buildApp({ store });
  t.after(() => app.close());
  let workspace = ContextWorkspaceSchema.parse((await app.inject({ method: 'POST', url: `${route()}/sources`, payload: imported })).json());
  for (const rationale of ['First proposal', 'Second proposal']) {
    workspace = ContextWorkspaceSchema.parse((await app.inject({ method: 'POST', url: `${route()}/proposals`, payload: proposed(workspace, { rationale }) })).json());
  }
  const responses = await Promise.all(workspace.proposals.map(proposal => app.inject({
    method: 'POST', url: `${route()}/proposals/${proposal.id}/review`,
    payload: { decision: 'accepted', reviewer: 'Reviewer', note: '' },
  })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  const final = ContextWorkspaceSchema.parse((await app.inject({ method: 'GET', url: route() })).json());
  assert.equal(final.approvals.length, 1);
  assert.equal(final.proposals.filter(proposal => proposal.status === 'accepted').length, 1);
  assert.deepEqual(await store.get('ui-fixture'), run);
});

test('memory context persistence isolates snapshots and rejects stale revisions', async () => {
  const store = createMemoryStore();
  const context = store.context!;
  const workspace = importContext(emptyContext('stored-run'), { ...imported, kind: 'synthetic' });
  assert.equal(await context.save(workspace, 0), true);
  workspace.sources[0].title = 'Unsaved mutation';
  const restored = (await context.get('stored-run'))!;
  assert.equal(restored.sources[0].title, imported.title);
  restored.sources.length = 0;
  assert.equal((await context.get('stored-run'))?.sources.length, 1);
  assert.equal(await context.save({ ...workspace, revision: 2 }, 0), false);
  assert.equal((await context.get('stored-run'))?.revision, 1);
  assert.equal(await context.get('other-run'), undefined);
});

test('HTTP surfaces a storage compare-and-swap conflict without reporting a successful write', async t => {
  const store = createMemoryStore();
  await store.save(createUiFixture());
  store.context!.save = async () => false;
  const app = buildApp({ store });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: `${route()}/sources`, payload: imported });
  assert.equal(response.statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: route() })).json().revision, 0);
});

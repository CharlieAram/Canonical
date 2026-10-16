import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RecordId } from 'surrealdb';
import type { ContextWorkspace, ContextSource, ContextProposal, ApprovedContext } from '@canonical/contracts';
import { createUiFixture } from '@canonical/demo';
import { connectSurreal, createSurrealStore, getRequirementProvenance, initializeSurreal } from '../integrations/surrealdb.ts';
import { buildApp } from '../apps/api/src/app.ts';

function reviewedWorkspace(runId: string): ContextWorkspace {
  const text = 'A quote must always use the requesting account’s price.';
  const now = new Date().toISOString();
  const source: ContextSource = {
    id: 'source', runId, title: 'Synthetic pricing conversation', kind: 'synthetic', text,
    contentHash: createHash('sha256').update(text).digest('hex'), importedAt: now,
    segments: [{ id: 'segment', text, line: 1, start: 0, end: text.length }],
  };
  const proposal: ContextProposal = {
    id: 'proposal', runId, sourceId: source.id, segmentId: 'segment', quote: text,
    requirementId: 'account-price', requirementText: text, conceptIds: ['quote', 'cache'],
    rationale: 'The conversation explicitly requires separate account prices.',
    status: 'accepted', createdAt: now, reviewedAt: now, reviewer: 'Demo reviewer', method: 'manual',
  };
  const { text: _text, segments, ...sourceMetadata } = source;
  const approval: ApprovedContext = {
    id: 'approval', runId, proposalId: proposal.id, requirementId: proposal.requirementId,
    requirementText: proposal.requirementText, conceptIds: proposal.conceptIds, version: 1,
    rationale: proposal.rationale, approvedAt: now, reviewer: proposal.reviewer!,
    source: sourceMetadata, segment: segments[0], quote: text, association: 'reviewed-context',
  };
  return { runId, revision: 1, sources: [source], proposals: [proposal], approvals: [approval] };
}

test('Surreal context snapshots, native provenance and revision CAS remain isolated', {
  skip: !process.env.SURREAL_URL && 'Set SURREAL_URL to run the real context database integration test',
  timeout: 30_000,
}, async () => {
  const config = {
    url: process.env.SURREAL_URL!, namespace: 'canonical_context_checks',
    database: `test_${randomUUID().replaceAll('-', '')}`,
    username: process.env.SURREAL_USERNAME ?? 'root',
    password: process.env.SURREAL_PASSWORD ?? 'canonical-context-local-only',
    authLevel: 'root' as const,
  };
  await initializeSurreal(config);
  const db = await connectSurreal(config);
  const secondConnection = await connectSurreal(config);
  const store = createSurrealStore(db);
  const otherConnectionStore = createSurrealStore(secondConnection);
  const context = store.context!;
  const run = { ...createUiFixture(), id: `run-${randomUUID()}` };
  const otherRun = { ...createUiFixture(), id: `run-${randomUUID()}` };
  try {
    await store.save(run);
    await store.save(otherRun);
    const runBefore = await store.get(run.id);
    const otherBefore = await store.get(otherRun.id);
    const workspace = reviewedWorkspace(run.id);
    const otherWorkspace = reviewedWorkspace(otherRun.id);
    assert.equal(await context.get(run.id), undefined);
    assert.equal(await context.save(workspace, 0), true);
    assert.equal(await context.save(otherWorkspace, 0), true);
    assert.deepEqual(await context.get(run.id), workspace);
    assert.deepEqual(await otherConnectionStore.context!.get(run.id), workspace);
    assert.deepEqual(await store.get(run.id), runBefore, 'context never rewrites run results or business graph');

    const provenance = await getRequirementProvenance(db, run.id, 'account-price');
    assert.equal(provenance.length, 1);
    assert.deepEqual(provenance[0].approval, workspace.approvals[0]);
    assert.deepEqual(provenance[0].proposals, workspace.proposals);
    assert.deepEqual(provenance[0].segments, workspace.sources[0].segments);
    assert.equal(provenance[0].sources[0].id, workspace.sources[0].id);
    assert.equal(provenance[0].sources[0].runId, run.id);
    assert.equal('text' in provenance[0].sources[0], false, 'provenance does not return the full raw transcript');
    assert.deepEqual(await context.provenance!(run.id, 'account-price'), workspace.approvals);
    assert.deepEqual(await getRequirementProvenance(db, run.id, 'absent'), []);
    const [grounded] = await db.query<[unknown[]]>(
      'RETURN array::flatten((SELECT VALUE ->has_business_context->approved_requirement->grounds->concept.data.id FROM $run));',
      { run: new RecordId('analysis_run', run.id) },
    );
    assert.deepEqual(grounded.toSorted(), ['cache', 'quote']);

    // Same IDs in a different run cannot overwrite or enter this run's traversal.
    assert.deepEqual(await context.get(otherRun.id), otherWorkspace);
    assert.equal((await getRequirementProvenance(db, otherRun.id, 'account-price'))[0].sources[0].runId, otherRun.id);
    assert.equal(await context.save({ ...workspace, revision: 2 }, 1), true);
    assert.equal(await context.save({ ...workspace, revision: 2, approvals: [] }, 1), false);
    assert.equal((await context.get(run.id))?.approvals.length, 1, 'stale revision cannot erase approvals');
    await assert.rejects(context.save({ ...workspace, revision: 9 }, 2), /advance exactly once/);

    // Two independent SDK connections contend for the same revision. Exactly one
    // snapshot and its corresponding graph may win, including initial creation.
    const left = { ...workspace, revision: 3, sources: [{ ...workspace.sources[0], title: 'Left writer' }] };
    const right = { ...workspace, revision: 3, sources: [{ ...workspace.sources[0], title: 'Right writer' }] };
    const outcomes = await Promise.all([context.save(left, 2), otherConnectionStore.context!.save(right, 2)]);
    assert.deepEqual(outcomes.toSorted(), [false, true]);
    const winner = (await context.get(run.id))!;
    assert.equal(winner.sources[0].title, outcomes[0] ? 'Left writer' : 'Right writer');
    assert.equal((await getRequirementProvenance(db, run.id, 'account-price'))[0].sources[0].title, winner.sources[0].title);
    await db.query("DEFINE FIELD data.title ON context_source TYPE string ASSERT $value != 'REJECT_TRANSACTION';");
    await assert.rejects(context.save({
      ...winner, revision: 4, sources: [{ ...winner.sources[0], title: 'REJECT_TRANSACTION' }],
    }, 3));
    assert.deepEqual(await context.get(run.id), winner, 'a failed graph write rolls back the workspace revision too');
    assert.equal((await getRequirementProvenance(db, run.id, 'account-price'))[0].sources[0].title, winner.sources[0].title);
    const freshId = `run-${randomUUID()}`;
    await store.save({ ...createUiFixture(), id: freshId });
    const freshWorkspace = reviewedWorkspace(freshId);
    const firstSaves = await Promise.all([
      context.save(freshWorkspace, 0), otherConnectionStore.context!.save(freshWorkspace, 0),
    ]);
    assert.deepEqual(firstSaves.toSorted(), [false, true]);

    // The graph is authoritative for traversal: remove a scoped relationship and
    // verify that the stored approval's embedded quote is not used as a shortcut.
    await db.query('DELETE supported_by WHERE runId = $runId;', { runId: run.id });
    const disconnected = await getRequirementProvenance(db, run.id, 'account-price');
    assert.equal(disconnected[0].proposals.length, 1);
    assert.deepEqual(disconnected[0].segments, []);
    assert.deepEqual(disconnected[0].sources, []);
    assert.deepEqual(await context.provenance!(run.id, 'account-price'), [], 'API provenance requires an intact native graph path');
    assert.deepEqual(await store.get(run.id), runBefore);
    assert.deepEqual(await store.get(otherRun.id), otherBefore);
    assert.deepEqual(await context.get(otherRun.id), otherWorkspace);
    assert.equal((await getRequirementProvenance(db, otherRun.id, 'account-price'))[0].segments.length, 1);
  } finally {
    try { await db.query(`REMOVE DATABASE ${config.database};`); }
    finally { await Promise.all([store.close(), otherConnectionStore.close()]); }
  }
});

test('database EDITOR supports HTTP context approval, durable provenance and cited export', {
  skip: !process.env.SURREAL_URL && 'Set SURREAL_URL to run the real context API integration test',
  timeout: 30_000,
}, async t => {
  const config = {
    url: process.env.SURREAL_URL!, namespace: 'canonical_context_checks',
    database: `api_${randomUUID().replaceAll('-', '')}`,
    username: process.env.SURREAL_USERNAME ?? 'root',
    password: process.env.SURREAL_PASSWORD ?? 'canonical-context-local-only',
    authLevel: 'root' as const,
  };
  await initializeSurreal(config);
  const admin = await connectSurreal(config);
  t.after(() => admin.close());
  const databaseConfig = {
    ...config, username: 'canonical_context_editor', password: 'canonical-context-database-local-only',
    authLevel: 'database' as const,
  };
  // DEFINE USER requires a string literal here; this is a fixed test-only password.
  await admin.query("DEFINE USER canonical_context_editor ON DATABASE PASSWORD 'canonical-context-database-local-only' ROLES EDITOR;");
  // This calls schema initialization under DATABASE/EDITOR authentication too,
  // matching the intended hosted application account rather than a root login.
  const db = await connectSurreal(databaseConfig);
  const store = createSurrealStore(db);
  const app = buildApp({ store });
  let reconnectedDb: Awaited<ReturnType<typeof connectSurreal>> | undefined;
  let reconnectedApp: ReturnType<typeof buildApp> | undefined;
  const run = { ...createUiFixture(), id: `api-${randomUUID()}` };
  const url = `/api/runs/${run.id}/business-context`;
  const quote = 'Keep the two accounts separate even when the price cache is warm.';
  try {
    const importedRun = await app.inject({ method: 'POST', url: '/api/runs/import', payload: run });
    assert.equal(importedRun.statusCode, 201);
    const sourceResponse = await app.inject({ method: 'POST', url: `${url}/sources`, payload: {
      title: 'Synthetic pricing decision — API smoke', kind: 'synthetic',
      text: `[00:00:21] Product owner: ${quote}`,
    } });
    assert.equal(sourceResponse.statusCode, 201, sourceResponse.body);
    const workspace = sourceResponse.json<ContextWorkspace>();
    assert.equal(workspace.revision, 1);
    const source = workspace.sources[0];
    assert.equal(source.kind, 'synthetic');
    assert.equal(source.segments[0].timestamp, '00:00:21');
    const proposed = await app.inject({ method: 'POST', url: `${url}/proposals`, payload: {
      sourceId: source.id, segmentId: source.segments[0].id, quote,
      requirementId: 'account-price', rationale: 'The explicit account-separation decision supports account-specific pricing.',
    } });
    assert.equal(proposed.statusCode, 201, proposed.body);
    const proposal = proposed.json<ContextWorkspace>().proposals[0];
    const accepted = await app.inject({ method: 'POST', url: `${url}/proposals/${proposal.id}/review`, payload: {
      decision: 'accepted', reviewer: 'API integration reviewer', note: 'Synthetic test evidence, reviewed explicitly.',
    } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const reviewed = accepted.json<ContextWorkspace>();
    assert.equal(reviewed.revision, 3);
    assert.equal(reviewed.approvals.length, 1);
    assert.equal(reviewed.approvals[0].quote, quote);
    assert.equal(reviewed.approvals[0].source.id, source.id);
    assert.equal(reviewed.approvals[0].segment.id, source.segments[0].id);
    assert.equal(reviewed.approvals[0].association, 'reviewed-context');
    const fetched = await app.inject({ method: 'GET', url });
    assert.deepEqual(fetched.json(), reviewed);
    const exported = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/context` });
    assert.equal(exported.statusCode, 200);
    assert.ok(exported.body.includes(`> ${quote}`));
    assert.match(exported.body, /Synthetic pricing decision — API smoke \(synthetic\)/);
    assert.match(exported.body, /timestamp 00:00:21/);
    assert.match(exported.body, /reviewed after execution/);
    assert.deepEqual((await store.get(run.id))?.results, run.results, 'approving context cannot rewrite the failed execution evidence');

    // Simulate an API restart with a new connection/store, not a second read of
    // the existing in-process objects. The saved review and native graph survive.
    reconnectedDb = await connectSurreal(databaseConfig);
    reconnectedApp = buildApp({ store: createSurrealStore(reconnectedDb) });
    await app.close();
    const afterRestart = await reconnectedApp.inject({ method: 'GET', url });
    assert.equal(afterRestart.statusCode, 200);
    assert.deepEqual(afterRestart.json(), reviewed);
    const exportedAgain = await reconnectedApp.inject({ method: 'GET', url: `/api/runs/${run.id}/context` });
    assert.ok(exportedAgain.body.includes(`> ${quote}`));

    // Verify that both API surfaces depend on native provenance, even though
    // the immutable snapshot still contains the original accepted association.
    await reconnectedDb.query('DELETE supported_by WHERE runId = $runId;', { runId: run.id });
    const withoutPath = await reconnectedApp.inject({ method: 'GET', url });
    assert.deepEqual(withoutPath.json<ContextWorkspace>().approvals, []);
    const withoutCitation = await reconnectedApp.inject({ method: 'GET', url: `/api/runs/${run.id}/context` });
    assert.equal(withoutCitation.body.includes(`> ${quote}`), false);
    const [snapshot] = await reconnectedDb.query<[{ data: ContextWorkspace }[]]>(
      'SELECT data FROM $workspace;', { workspace: new RecordId('context_workspace', run.id) },
    );
    assert.equal(snapshot[0].data.approvals.length, 1);
  } finally {
    try { await admin.query(`REMOVE DATABASE ${config.database};`); }
    finally { await Promise.all([app.close(), reconnectedApp?.close(), admin.close()]); }
  }
});

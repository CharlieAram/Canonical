import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RecordId } from 'surrealdb';
import { createRun } from '@canonical/demo';
import { connectSurreal, createSurrealStore, getDownstreamConcepts, watchRuns } from '@canonical/integrations/surrealdb';

// Explicit opt-in: npm run test:surreal. All records use isolated IDs, and cleanup
// removes only these records, allowing this test to share a development database.
test('SurrealDB persists graph evidence, isolates traversals, and emits live changes', {
  skip: !process.env.SURREAL_URL && 'Set SURREAL_URL to run the real database integration test',
  timeout: 20_000,
}, async () => {
  const db = await connectSurreal({
    url: process.env.SURREAL_URL!,
    namespace: process.env.SURREAL_NAMESPACE ?? 'canonical',
    database: process.env.SURREAL_DATABASE ?? 'development',
    username: process.env.SURREAL_USERNAME ?? 'root',
    password: process.env.SURREAL_PASSWORD ?? 'canonical-local-only',
  });
  const store = createSurrealStore(db);
  const run = createRun(`integration-${randomUUID()}`, 'local');
  const other = createRun(`integration-${randomUUID()}`, 'local');
  let stopWatching: (() => Promise<unknown>) | undefined;
  let notificationTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    assert.equal(await store.get(run.id), undefined);
    await store.save(run);
    await store.save(other);
    const restored = await store.get(run.id);
    assert.ok(restored);
    assert.deepEqual(restored.requirements, run.requirements);
    assert.deepEqual(restored.graph.nodes.toSorted((a, b) => a.id.localeCompare(b.id)), run.graph.nodes.toSorted((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(restored.graph.edges.toSorted((a, b) => a.id.localeCompare(b.id)), run.graph.edges.toSorted((a, b) => a.id.localeCompare(b.id)));
    assert.ok((await store.list()).some(item => item.id === run.id));

    const downstream = await getDownstreamConcepts(db, run.id, 'cache');
    assert.deepEqual(downstream.map(node => node.id), ['quote']);
    // A one-hop query excludes the second-hop order and another run's quote.
    assert.equal(downstream.length, 1);
    assert.deepEqual(await getDownstreamConcepts(db, run.id, 'order'), []);

    let onChange!: () => void;
    const changed = new Promise<void>((resolve, reject) => {
      onChange = resolve;
      notificationTimeout = setTimeout(() => reject(new Error('No live change received after saving the run')), 5_000);
    });
    stopWatching = await watchRuns(db, onChange);
    run.status = 'running';
    run.stage = 'Integration update';
    await store.save(run);
    await changed;
    assert.equal((await store.get(run.id))?.stage, 'Integration update');
    assert.equal((await store.get(other.id))?.status, 'queued');
    const [counts] = await db.query<[{ total: number }[]]>(
      'SELECT count() AS total FROM depends_on WHERE runId = $runId GROUP ALL;', { runId: run.id },
    );
    assert.equal(counts[0].total, run.graph.edges.length, 'saving again must replace relationships rather than duplicate them');
  } finally {
    if (notificationTimeout) clearTimeout(notificationTimeout);
    await stopWatching?.();
    try {
      for (const id of [run.id, other.id]) {
        await db.query('DELETE depends_on WHERE runId = $runId; DELETE concept WHERE runId = $runId; DELETE $record;', {
          runId: id, record: new RecordId('analysis_run', id),
        });
      }
    } finally { await store.close(); }
  }
});

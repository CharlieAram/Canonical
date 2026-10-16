import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RecordId } from 'surrealdb';
import { createRun } from '@canonical/demo';
import { connectSurreal, createSurrealStore, getDownstreamConcepts, watchRuns } from '@canonical/integrations/surrealdb';
import { readConfig } from '../apps/api/src/config.ts';

const db = await connectSurreal(readConfig().surreal);
const store = createSurrealStore(db);
const run = createRun(`smoke-${randomUUID()}`, 'local');
let stop: (() => Promise<void>) | undefined;
try {
  let observed = false;
  stop = await watchRuns(db, () => { observed = true; });
  await store.save(run);
  assert.equal((await store.get(run.id))?.graph.nodes.length, run.graph.nodes.length);
  assert.ok((await getDownstreamConcepts(db, run.id, 'quote')).length > 0);
  const deadline = Date.now() + 5000;
  while (!observed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(observed, 'No live notification received');
  console.log('SurrealDB verified: persisted report, native graph traversal, live notification.');
} finally {
  try {
    await stop?.();
    await db.query('DELETE depends_on WHERE runId = $id; DELETE concept WHERE runId = $id; DELETE $record;', {
      id: run.id, record: new RecordId('analysis_run', run.id),
    });
  } finally { await store.close(); }
}

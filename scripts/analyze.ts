import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ExecutionModeSchema } from '@canonical/contracts';
import { createRun } from '@canonical/demo';
import { createEvaluator, executeRun, exportContext } from '@canonical/runner';
import { readConfig } from '../apps/api/src/config.ts';
import { createStore } from '../apps/api/src/store.ts';

const { values } = parseArgs({ options: { execution: { type: 'string', default: 'local' } } });
const config = readConfig();
const run = createRun(randomUUID(), ExecutionModeSchema.parse(values.execution));
const evaluate = createEvaluator(run, config.daytona);
const store = await createStore(config);
try {
  await executeRun(run, store, evaluate);
  const output = new URL('../.canonical/output/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL(`${run.id}.json`, output), JSON.stringify(run, null, 2));
  await writeFile(new URL('context.md', output), exportContext(run));
  console.log(`Run ${run.id}: ${run.status}. Report and context saved in .canonical/output/`);
  console.log('Source: built-in pricing fixture; no Git analysis yet.');
  const failed = run.results.flatMap(result => result.checks).filter(check => check.status === 'failed');
  failed.forEach(check => console.log(`FAIL ${check.label}: ${check.actual}`));
  process.exitCode = run.status === 'error' ? 2 : failed.length ? 1 : 0;
} finally {
  await store.close();
}

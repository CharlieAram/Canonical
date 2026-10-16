import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ExecutionModeSchema } from '@canonical/contracts';
import { createRun } from '@canonical/demo';
import { createEvaluator, createRepositoryRun, prepareRepositoryComparison, executeRun, exportContext } from '@canonical/runner';
import { executeRepositoryReview } from '../packages/runner/src/review-pipeline.ts';
import { extractObjects, extractLogic } from '../packages/runner/src/extraction.ts';
import { createModelExtractors } from '../packages/runner/src/model-extraction.ts';
import { readConfig } from '../apps/api/src/config.ts';
import { createStore } from '../apps/api/src/store.ts';

const { values } = parseArgs({ options: {
  execution: { type: 'string', default: 'local' },
  repo: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' },
  output: { type: 'string', default: '.canonical/output' },
} });
const config = readConfig();
const execution = ExecutionModeSchema.parse(values.execution);
if (values.repo && (!values.base || !values.head || execution !== 'daytona')) {
  throw new Error('Repository comparison requires --execution daytona --repo PATH --base REF --head REF');
}
if (!values.repo && (values.base || values.head)) throw new Error('--base and --head require --repo');
if (execution === 'daytona' && !config.daytona?.apiKey) throw new Error('DAYTONA_API_KEY is required');
const comparison = values.repo ? await prepareRepositoryComparison(values.repo, values.base!, values.head!) : undefined;
let store: Awaited<ReturnType<typeof createStore>> | undefined;
try {
  const run = comparison ? createRepositoryRun(randomUUID(), comparison) : createRun(randomUUID(), execution);
  store = await createStore(config);
  if (comparison) {
    await executeRepositoryReview(run, store, comparison, {
      daytona: config.daytona,
      extractors: config.extraction.mode === 'openai'
        ? createModelExtractors(config.openai!)
        : { method: 'static-analysis', objects: extractObjects, logic: extractLogic },
      trigger: process.env.GITHUB_ACTIONS === 'true' ? {
        kind: 'github',
        url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
      } : { kind: 'cli' },
    });
  } else {
    await executeRun(run, store, createEvaluator(run, config.daytona));
  }
  const output = resolve(values.output);
  await mkdir(output, { recursive: true });
  const report = JSON.stringify(run, null, 2);
  const context = exportContext(run);
  await Promise.all([
    writeFile(resolve(output, 'report.json'), report),
    writeFile(resolve(output, `${run.id}.json`), report),
    writeFile(resolve(output, 'context.md'), context),
    writeFile(resolve(output, 'report.md'), context),
  ]);
  console.log(`Run ${run.id}: ${run.status}. Report and context saved in ${output}`);
  console.log(run.source.kind === 'git'
    ? `Git: ${run.source.baseSha} -> ${run.source.headSha}; policy from baseline.`
    : 'Source: built-in pricing fixture.');
  const failed = run.results.flatMap(result => result.checks).filter(check => check.status === 'failed');
  failed.forEach(check => console.log(`FAIL ${check.label}: ${check.actual}`));
  process.exitCode = run.status === 'error' ? 2 : failed.length ? 1 : 0;
} finally {
  try { await store?.close(); } finally { await comparison?.dispose(); }
}

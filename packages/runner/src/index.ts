import { EvaluationSchema, type AnalysisRun, type Evaluation, type RunStore, type Variant } from '@canonical/contracts';
import { evaluateWithDaytona, type DaytonaConfig } from '@canonical/integrations/daytona';
import { evaluateLocally } from './local.ts';

export { exportContext } from './context.ts';
export { evaluateLocally } from './local.ts';

export type Evaluator = (variant: Variant) => Promise<Evaluation>;

export function createEvaluator(run: AnalysisRun, daytona?: DaytonaConfig): Evaluator {
  if (run.source.kind === 'git') throw new Error('Git runs require a prepared repository evaluator');
  if (run.execution === 'local') return evaluateLocally;
  if (!daytona?.apiKey) throw new Error('Daytona is not configured');
  return variant => evaluateWithDaytona(variant, daytona);
}

export async function executeRun(run: AnalysisRun, store: RunStore, evaluate: Evaluator): Promise<AnalysisRun> {
  const save = async () => {
    run.updatedAt = new Date().toISOString();
    await store.save(run);
  };
  try {
    run.status = 'running';
    for (const variant of ['baseline', 'candidate'] as const) {
      run.stage = `Evaluating ${variant}`;
      await save();
      const result = EvaluationSchema.parse(await evaluate(variant));
      if (result.variant !== variant) throw new Error('Harness returned the wrong variant');
      if (run.source.kind === 'git' && result.commitSha !== (variant === 'baseline' ? run.source.baseSha : run.source.headSha)) {
        throw new Error('Harness returned evidence for the wrong Git commit');
      }
      const ids = result.checks.map(check => check.requirementId);
      if (ids.length !== run.requirements.length || new Set(ids).size !== ids.length || run.requirements.some(rule => !ids.includes(rule.id))) {
        throw new Error('Harness did not return every approved requirement exactly once');
      }
      run.results.push(result);
      if (variant === 'candidate') {
        const failed = new Set(result.checks.filter(check => check.status === 'failed').flatMap(check => check.conceptIds));
        run.graph.nodes.forEach(node => { if (failed.has(node.id)) node.impact = 'failed'; });
      }
      await save();
    }
    run.status = 'completed';
    run.stage = 'Review ready';
  } catch (error) {
    run.status = 'error';
    run.stage = 'Evaluation could not complete';
    // Do not send provider exceptions (which can contain HTTP credentials) to the browser.
    run.error = error instanceof Error && error.message.startsWith('Harness')
      ? error.message
      : 'Evaluation failed. Check the backend console and integration configuration.';
    console.error(`Canonical run ${run.id} failed (${error instanceof Error ? error.name : 'unknown error'}).`);
  }
  await save();
  return run;
}

export { prepareRepositoryComparison } from './repository.ts';
export { createRepositoryRun } from './repository-run.ts';

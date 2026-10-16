import {
  LayerDiffSchema, type AnalysisRun, type Review, type ReviewAgent, type LayerDiff,
  type RevisionSource, type RunStore,
} from '@canonical/contracts';
import { evaluateRepositoryWithDaytona, type DaytonaConfig } from '@canonical/integrations/daytona';
import { executeRun, type Evaluator } from './index.ts';
import type { PreparedRepositoryComparison } from './repository.ts';

export interface LayerExtractors {
  method: 'static-analysis' | 'model';
  objects(before: RevisionSource, after: RevisionSource): LayerDiff | Promise<LayerDiff>;
  logic(before: RevisionSource, after: RevisionSource): LayerDiff | Promise<LayerDiff>;
}
export function initialReview(run: AnalysisRun, method: LayerExtractors['method']): Review {
  const agent = (id: ReviewAgent['id'], label: string, mode: ReviewAgent['method']): ReviewAgent => ({ id, label, method: mode, status: 'queued', message: 'Waiting to start' });
  return {
    version: 1, sequence: 0, events: [],
    agents: [agent('objects', 'Object layer extraction', method), agent('logic', 'Logic flow extraction', method), agent('business-checks', 'Bill of business checks', 'daytona')],
    billOfBusiness: run.requirements.map(rule => ({ ...rule, status: 'pending', baselineStatus: 'pending', candidateStatus: 'pending', evidence: [] })),
  };
}

export function refreshBusinessVerdicts(run: AnalysisRun) {
  if (!run.review) return;
  run.review.billOfBusiness = run.requirements.map(rule => {
    const evidence = run.results.flatMap(result => result.checks.filter(check => check.requirementId === rule.id).map(check => ({
      variant: result.variant, checkId: check.id, status: check.status, expected: check.expected, actual: check.actual, commitSha: result.commitSha,
    })));
    const outcome = (variant: 'baseline' | 'candidate') => evidence.find(item => item.variant === variant)?.status ?? (run.status === 'error' ? 'error' : 'pending');
    const baselineStatus = outcome('baseline');
    const candidateStatus = outcome('candidate');
    const status = baselineStatus === 'failed' || candidateStatus === 'failed' ? 'failed'
      : baselineStatus === 'error' || candidateStatus === 'error' ? 'error'
      : baselineStatus === 'passed' && candidateStatus === 'passed' ? 'passed' : 'pending';
    return { ...rule, status, baselineStatus, candidateStatus, evidence };
  });
}

export async function executeRepositoryReview(
  run: AnalysisRun, store: RunStore, comparison: PreparedRepositoryComparison,
  options: { extractors: LayerExtractors; daytona?: DaytonaConfig; evaluate?: Evaluator; trigger?: Review['trigger'] },
): Promise<AnalysisRun> {
  if (run.source.kind !== 'git') throw new Error('Repository review requires Git provenance');
  run.review = initialReview(run, options.extractors.method);
  run.review.trigger = options.trigger;
  let writeQueue = Promise.resolve();
  function persist(message: string, agentId?: ReviewAgent['id']) {
    const review = run.review!;
    run.updatedAt = new Date().toISOString();
    review.sequence++;
    review.events.push({ sequence: review.sequence, at: run.updatedAt, agentId, message });
    refreshBusinessVerdicts(run);
    const snapshot = structuredClone(run);
    writeQueue = writeQueue.then(() => store.save(snapshot));
    return writeQueue;
  }
  function updateAgent(id: ReviewAgent['id'], status: ReviewAgent['status'], message: string) {
    const agent = run.review!.agents.find(item => item.id === id)!;
    agent.status = status; agent.message = message;
    if (status === 'running') agent.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'error') agent.completedAt = new Date().toISOString();
  }
  await persist('Commit received; analysis tasks queued');
  run.status = 'running'; run.stage = 'Extracting object layer and logic flow';
  await persist(run.stage);
  const layers = await Promise.allSettled((['objects', 'logic'] as const).map(async id => {
    updateAgent(id, 'running', 'Reading both immutable Git revisions');
    await persist(`${id} extraction started`, id);
    try {
      const layer = LayerDiffSchema.parse(await options.extractors[id](comparison.sources.baseline, comparison.sources.candidate));
      run.review![id] = layer;
      updateAgent(id, 'completed', layer.summary);
      await persist(`${id} extraction completed`, id);
    } catch (error) {
      updateAgent(id, 'error', 'Extraction could not complete. Check runner configuration.');
      await persist(`${id} extraction failed`, id);
      throw error;
    }
  }));
  updateAgent('business-checks', 'running', 'Executing approved requirements against both revisions in Daytona');
  await persist('Business checks started', 'business-checks');
  const evaluate = options.evaluate ?? (variant => {
    if (!options.daytona) throw new Error('Daytona is not configured');
    return evaluateRepositoryWithDaytona(variant, {
      bundlePath: comparison.bundlePath, sha: variant === 'baseline' ? comparison.baseSha : comparison.headSha,
    }, options.daytona);
  });
  const extractionFailed = layers.some(result => result.status === 'rejected');
  const progressStore: RunStore = {
    kind: store.kind, get: id => store.get(id), list: () => store.list(), close: async () => {},
    save: async () => {
      if (run.status === 'completed' || run.status === 'error') {
        updateAgent('business-checks', run.status === 'error' ? 'error' : 'completed', run.status === 'error' ? 'Execution could not complete' : 'All approved requirements have executed evidence');
      }
      if (run.status === 'completed' && extractionFailed) {
        run.status = 'error'; run.stage = 'Review incomplete: extraction failed';
        run.error = 'One or more extraction tasks failed. Executed check evidence is retained.';
      }
      await persist(run.stage, 'business-checks');
    },
  };
  await executeRun(run, progressStore, evaluate);
  if (extractionFailed) {
    run.status = 'error'; run.stage = 'Review incomplete: extraction failed';
    run.error = 'One or more extraction tasks failed. Executed check evidence is retained.';
  }
  await persist(run.status === 'error' ? run.stage : 'Commit review ready');
  return run;
}

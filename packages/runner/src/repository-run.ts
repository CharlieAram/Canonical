import { RunSchema, type AnalysisRun } from '@canonical/contracts';
import type { PreparedRepositoryComparison } from './repository.ts';

export function createRepositoryRun(id: string, comparison: PreparedRepositoryComparison): AnalysisRun {
  const now = new Date().toISOString();
  return RunSchema.parse({
    id, execution: 'daytona', status: 'queued', stage: 'Ready to evaluate Git revisions',
    createdAt: now, updatedAt: now,
    source: {
      kind: 'git', name: comparison.repositoryName,
      baseline: comparison.baseSha.slice(0, 7), candidate: comparison.headSha.slice(0, 7),
      baseSha: comparison.baseSha, headSha: comparison.headSha,
      changedFiles: comparison.changedFiles, policyPath: '.canonical/business.json',
    },
    graph: { ...comparison.policy.graph, provenance: 'declared-policy' },
    requirements: comparison.policy.requirements, results: [],
  });
}

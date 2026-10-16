import type { AnalysisRun } from '@canonical/contracts';

// Presentation-only derivations from a run. Nothing here invents a measurement.
type Requirement = AnalysisRun['requirements'][number];
export type Verdict = { tone: 'added' | 'failed' | 'modified' | 'neutral'; label: string; detail?: string };
export type RequirementStatus = { requirement: Requirement; status: 'met' | 'failed' | 'unverified'; note: string };

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const milliseconds = (value: number) => value < 0.01 ? '<0.01' : value.toFixed(2);

export function variants(run: AnalysisRun) {
  return { baseline: run.results.find(result => result.variant === 'baseline'), candidate: run.results.find(result => result.variant === 'candidate') };
}

export function verdict(run: AnalysisRun): Verdict {
  if (run.status === 'error') return { tone: 'failed', label: 'Error', detail: 'evaluation stopped' };
  if (run.status !== 'completed') return { tone: 'neutral', label: run.status === 'queued' ? 'Queued' : 'Running' };
  const { candidate } = variants(run);
  const failed = candidate?.checks.filter(check => check.status === 'failed').length ?? 0;
  if (!candidate) return { tone: 'modified', label: 'Needs review', detail: 'no candidate evidence' };
  return failed ? { tone: 'failed', label: 'Blocked', detail: `${plural(failed, 'requirement')} failed` } : { tone: 'added', label: 'Passed', detail: 'candidate checks met' };
}

export function requirementStatuses(run: AnalysisRun): RequirementStatus[] {
  const { candidate } = variants(run);
  return run.requirements.map(requirement => {
    const checks = candidate?.checks.filter(check => check.requirementId === requirement.id) ?? [];
    if (!checks.length) return { requirement, status: 'unverified', note: candidate ? 'Not verified · no executable check targets this rule' : 'Not verified yet · awaiting candidate evidence' };
    const failed = checks.find(check => check.status === 'failed');
    if (failed) return { requirement, status: 'failed', note: `Failed · expected ${failed.expected}, observed ${failed.actual}` };
    return { requirement, status: 'met', note: `Met · ${checks.map(check => check.label).join(', ')}` };
  });
}

export function speedup(run: AnalysisRun) {
  const { baseline, candidate } = variants(run);
  // Avoid amplifying sub-display-precision samples into an unstable speedup claim.
  return baseline && candidate && candidate.benchmark.median >= 0.01 ? baseline.benchmark.median / candidate.benchmark.median : undefined;
}

export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${plural(hours, 'hour')} ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

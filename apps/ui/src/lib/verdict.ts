import type { AnalysisRun } from '@canonical/contracts';

// Presentation-only derivations from a run. Nothing here invents a measurement.
export const milliseconds = (value: number) => value < 0.01 ? '<0.01' : value.toFixed(2);

export function variants(run: AnalysisRun) {
  return { baseline: run.results.find(result => result.variant === 'baseline'), candidate: run.results.find(result => result.variant === 'candidate') };
}

import type { AnalysisRun } from '@canonical/contracts';

const phase = (run: AnalysisRun) => run.status === 'queued' ? 0 : run.status === 'running' ? 1 : 2;

// HTTP responses and SSE events can arrive in a different order from persistence.
// A review's sequence is the strongest ordering; legacy fixtures use timestamps.
export function newestRun(current: AnalysisRun, incoming: AnalysisRun): AnalysisRun {
  const currentSequence = current.review?.sequence ?? -1;
  const incomingSequence = incoming.review?.sequence ?? -1;
  if (currentSequence !== incomingSequence) return incomingSequence > currentSequence ? incoming : current;
  if (current.updatedAt !== incoming.updatedAt) return incoming.updatedAt > current.updatedAt ? incoming : current;
  if (phase(current) !== phase(incoming)) return phase(incoming) > phase(current) ? incoming : current;
  // Millisecond ties must not drop already delivered execution evidence.
  if (incoming.results.length < current.results.length) return current;
  return incoming;
}

export function mergeRunSnapshots(current: AnalysisRun[], incoming: AnalysisRun[]): AnalysisRun[] {
  const merged = new Map(current.map(run => [run.id, run]));
  for (const run of incoming) {
    const previous = merged.get(run.id);
    merged.set(run.id, previous ? newestRun(previous, run) : run);
  }
  // Retain observed entries omitted by an older response or the server's history
  // window. There is currently no run-deletion action requiring removal here.
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function newlyDiscoveredRun(runs: AnalysisRun[], seen: Set<string>): AnalysisRun | undefined {
  const newest = runs[0];
  const arrival = newest && !seen.has(newest.id) ? newest : undefined;
  for (const run of runs) seen.add(run.id);
  return arrival;
}

import type { AnalysisRun } from '@canonical/contracts';

export function exportContext(run: AnalysisRun): string {
  const lines = [
    '# Canonical business context', '',
    `Run: ${run.id}`, `Status: ${run.status}`, `Execution: ${run.execution}`,
    `Updated: ${run.updatedAt}`, '',
    'Source: built-in pricing fixture. No Git revision or AI extraction is claimed.', '',
    '## Approved requirements', '',
    ...run.requirements.map(rule => `- ${rule.id}: ${rule.text}`), '',
    '## Business concepts', '',
    ...run.graph.nodes.map(node => `- ${node.label}: ${node.description}`), '',
    '## Executed evidence', '',
    ...run.results.flatMap(result => [
      `### ${result.variant}`, '',
      ...result.checks.map(check => `- ${check.status.toUpperCase()} ${check.label}: expected ${check.expected}; observed ${check.actual}.`),
      `- Warm quote median: ${result.benchmark.median.toFixed(3)} ms; simulated upstream: ${result.benchmark.simulatedUpstreamMs} ms.`,
      ...result.warnings.map(warning => `- Warning: ${warning}`), '',
    ]),
    ...(run.error ? [`Execution error: ${run.error}`, ''] : []),
    '## Guidance for the next change', '',
    'Preserve account-specific pricing when choosing cache keys. A faster incorrect quote violates the approved requirement.',
    'Reproduce with `node checks/pricing.mjs baseline` and `node checks/pricing.mjs candidate`.',
    'These commands emit check statuses as JSON; the analysis CLI exits nonzero when a business check fails.',
    'Refresh this context after changes. Passing fixture checks do not prove correctness for arbitrary inputs.', '',
  ];
  return lines.join('\n');
}

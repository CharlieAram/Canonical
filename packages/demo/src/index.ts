import { RunSchema, type AnalysisRun, type ExecutionMode, type Graph } from '@canonical/contracts';

export function createGraph(): Graph {
  return {
    provenance: 'declared-fixture',
    nodes: [
      { id: 'account', label: 'Account', description: 'The customer requesting a price.', change: 'unchanged', impact: 'none', position: { x: 0, y: 60 } },
      { id: 'policy', label: 'Price policy', description: 'Wholesale pays $80; retail pays $100 for the demo product.', change: 'unchanged', impact: 'none', position: { x: 240, y: 0 } },
      { id: 'quote', label: 'Quote', description: 'A price for the requesting account and product.', change: 'modified', impact: 'potential', position: { x: 480, y: 60 } },
      { id: 'cache', label: 'Price cache', description: 'The candidate shares cached prices by product, omitting the account.', change: 'added', impact: 'potential', position: { x: 240, y: 180 } },
      { id: 'order', label: 'Order', description: 'A potential downstream consumer; order behavior is not tested in v0.', change: 'unchanged', impact: 'potential', position: { x: 720, y: 60 } },
    ],
    edges: [
      { id: 'account-policy', source: 'account', target: 'policy', label: 'determines', change: 'unchanged' },
      { id: 'policy-quote', source: 'policy', target: 'quote', label: 'prices', change: 'unchanged' },
      { id: 'account-quote', source: 'account', target: 'quote', label: 'requests', change: 'unchanged' },
      { id: 'cache-quote', source: 'cache', target: 'quote', label: 'reuses price', change: 'added' },
      { id: 'quote-order', source: 'quote', target: 'order', label: 'informs', change: 'unchanged' },
    ],
  };
}

export function createRun(id: string, execution: ExecutionMode): AnalysisRun {
  const now = new Date().toISOString();
  return RunSchema.parse({
    id, execution, status: 'queued', stage: 'Ready to evaluate pricing fixture',
    createdAt: now, updatedAt: now,
    source: { kind: 'fixture', name: 'Quote shop / pricing cache', baseline: 'Account-scoped pricing', candidate: 'Product-only price cache' },
    graph: createGraph(),
    requirements: [
      { id: 'account-price', text: 'A quote must use the requesting account’s price.', conceptIds: ['account', 'policy', 'quote', 'cache'] },
      { id: 'repeat-price', text: 'Repeated quotes for the same inputs must return the same valid price.', conceptIds: ['quote'] },
      { id: 'positive-quantity', text: 'Quantity must be a positive integer.', conceptIds: ['quote'] },
    ],
    results: [],
  });
}

// Synthetic data ONLY for UI development. Actual evaluation lives in checks/pricing.mjs.
export function createUiFixture(): AnalysisRun {
  const run = createRun('ui-fixture', 'local');
  run.status = 'completed';
  run.stage = 'UI fixture — illustrative results, no execution';
  run.graph.nodes.find(node => node.id === 'quote')!.impact = 'failed';
  run.results = (['baseline', 'candidate'] as const).map(variant => ({
    variant, runtime: 'UI fixture', warnings: [],
    checks: [
      { id: 'account-price', requirementId: 'account-price', label: 'Account-specific pricing', conceptIds: ['quote', 'cache'], status: variant === 'baseline' ? 'passed' : 'failed', expected: 'Alpha: $80; Beta: $100', actual: variant === 'baseline' ? 'Alpha: $80; Beta: $100' : 'Alpha: $80; Beta: $80' },
      { id: 'repeat-price', requirementId: 'repeat-price', label: 'Repeat quote consistency', conceptIds: ['quote'], status: 'passed', expected: '$100 twice', actual: '$100 twice' },
      { id: 'positive-quantity', requirementId: 'positive-quantity', label: 'Reject invalid quantities', conceptIds: ['quote'], status: 'passed', expected: 'All invalid quantities rejected', actual: 'All invalid quantities rejected' },
    ],
    benchmark: { label: 'Illustrative warm repeat quote', unit: 'ms', samples: variant === 'baseline' ? [15, 16, 17] : [0.1, 0.2, 0.3], median: variant === 'baseline' ? 16 : 0.2, p95: variant === 'baseline' ? 17 : 0.3, upstreamCalls: variant === 'baseline' ? 23 : 1, simulatedUpstreamMs: 15 },
  }));
  return RunSchema.parse(run);
}

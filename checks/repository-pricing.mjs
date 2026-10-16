// Trusted Canonical harness, uploaded separately from the candidate repository.
// The repository supplies behavior, never its checks or command to execute.
import { createQuoteService } from '/tmp/canonical/repo/src/pricing.mjs';

const variant = process.argv[2];
if (!['baseline', 'candidate'].includes(variant)) throw new Error('Expected baseline or candidate');
const simulatedUpstreamMs = 15;
const service = () => createQuoteService(simulatedUpstreamMs);
const checks = [];

const pricing = service();
const alpha = await pricing.quote('alpha', 'demo-product');
const beta = await pricing.quote('beta', 'demo-product');
checks.push({
  id: 'account-price', requirementId: 'account-price', label: 'Account-specific pricing',
  conceptIds: ['quote', 'cache'], status: alpha === 80 && beta === 100 ? 'passed' : 'failed',
  expected: 'Alpha: $80; Beta: $100', actual: `Alpha: $${alpha}; Beta: $${beta}`,
});

const repeating = service();
const first = await repeating.quote('beta', 'demo-product');
const second = await repeating.quote('beta', 'demo-product');
checks.push({
  id: 'repeat-price', requirementId: 'repeat-price', label: 'Repeat quote consistency',
  conceptIds: ['quote'], status: first === 100 && second === 100 ? 'passed' : 'failed',
  expected: '$100 twice', actual: `$${first}, then $${second}`,
});

const quantities = service();
let rejected = 0;
for (const quantity of [0, -1, 0.5]) {
  try { await quantities.quote('beta', 'demo-product', quantity); } catch { rejected++; }
}
checks.push({
  id: 'positive-quantity', requirementId: 'positive-quantity', label: 'Reject invalid quantities',
  conceptIds: ['quote'], status: rejected === 3 ? 'passed' : 'failed',
  expected: '3 invalid quantities rejected', actual: `${rejected} invalid quantities rejected`,
});

const measured = service();
for (let i = 0; i < 3; i++) await measured.quote('beta', 'demo-product');
const samples = [];
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  const price = await measured.quote('beta', 'demo-product');
  samples.push(performance.now() - start);
  if (price !== 100) throw new Error('Benchmark returned an invalid price');
}
const sorted = [...samples].sort((a, b) => a - b);
console.log(JSON.stringify({
  variant, checks, runtime: process.version, warnings: [],
  benchmark: {
    label: 'Warm repeat quote (synthetic upstream)', unit: 'ms', samples,
    median: (sorted[9] + sorted[10]) / 2, p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    upstreamCalls: measured.upstreamCalls, simulatedUpstreamMs,
  },
}));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayerDiff, RevisionSource } from '@canonical/contracts';
import { extractLogic, extractObjects } from '../packages/runner/src/extraction.ts';

const baseline = `export function createQuoteService(upstreamMs = 15) {
  let upstreamCalls = 0;
  return {
    get upstreamCalls() { return upstreamCalls; },
    async quote(account, sku, quantity = 1) {
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid quantity');
      if (!['alpha', 'beta'].includes(account) || sku !== 'demo-product') throw new Error('Unknown pricing input');
      upstreamCalls++;
      await new Promise(resolve => setTimeout(resolve, upstreamMs));
      const price = account === 'alpha' ? 80 : 100;
      return price * quantity;
    },
  };
}
`;
const broken = baseline.replace('  let upstreamCalls', '  const cache = new Map();\n  let upstreamCalls')
  .replace('      upstreamCalls++;', '      if (cache.has(sku)) return cache.get(sku) * quantity;\n      upstreamCalls++;')
  .replace('      return price * quantity;', '      cache.set(sku, price);\n      return price * quantity;');
const fixed = broken.replace('      if (cache.has(sku))', '      const cacheKey = JSON.stringify([account, sku]);\n      if (cache.has(cacheKey))')
  .replace('cache.get(sku)', 'cache.get(cacheKey)').replace('cache.set(sku, price)', 'cache.set(cacheKey, price)');
const source = (content: string, sha = 'a'.repeat(40)): RevisionSource => ({ path: 'src/pricing.mjs', content, sha });
const changedNodes = (diff: LayerDiff) => diff.changes.filter(item => item.entity === 'node' && item.change !== 'unchanged');

test('object layer extracts source-defined state, returned service and cache-key inputs across real code shapes', () => {
  const added = extractObjects(source(baseline), source(broken, 'b'.repeat(40)));
  const cache = added.after.nodes.find(node => node.label === 'cache')!;
  assert.equal(cache.kind, 'collection');
  assert.equal(cache.properties.collection, 'Map');
  assert.equal(cache.properties.keyExpressions, 'sku');
  assert.equal(cache.properties.keyInputs, 'sku');
  assert.equal(cache.properties.operations, 'get, has, set');
  assert.ok(added.changes.some(change => change.id === cache.id && change.change === 'added'));
  assert.equal(added.after.nodes.find(node => node.kind === 'object')?.properties.fields, 'upstreamCalls, quote');
  assert.ok(added.after.nodes.some(node => node.kind === 'parameter' && node.label === 'account'));
  assert.ok(added.after.edges.some(edge => edge.label === 'uses' && edge.target === cache.id));

  const repaired = extractObjects(source(broken), source(fixed, 'c'.repeat(40)));
  const repairedCache = repaired.after.nodes.find(node => node.id === cache.id)!;
  assert.equal(repairedCache.properties.keyExpressions, 'JSON.stringify([account, sku])');
  assert.equal(repairedCache.properties.keyInputs, 'account, sku');
  assert.ok(repaired.changes.some(change => change.id === cache.id && change.change === 'modified'));
  assert.ok(repairedCache.citations.some(citation => citation.excerpt.includes('cacheKey = JSON.stringify')));
  assert.equal(repaired.provenance, 'static-analysis');
  assert.match(repaired.limitations.join(' '), /not inferred business intent or executed outcomes/);
});

test('logic layer emits branches, terminal paths, source calls and changed cache-key semantics', () => {
  const diff = extractLogic(source(baseline), source(broken, 'b'.repeat(40)));
  const branch = diff.after.nodes.find(node => node.kind === 'branch' && node.properties.condition === 'cache.has(sku)')!;
  assert.ok(branch);
  const outgoing = diff.after.edges.filter(edge => edge.source === branch.id);
  assert.deepEqual(outgoing.map(edge => edge.label).sort(), ['false', 'true']);
  const returned = diff.after.nodes.find(node => node.id === outgoing.find(edge => edge.label === 'true')!.target)!;
  assert.equal(returned.kind, 'return');
  assert.equal(returned.properties.value, 'cache.get(sku) * quantity');
  assert.equal(diff.after.edges.some(edge => edge.source === returned.id), false, 'return terminates that path');
  assert.ok(diff.after.nodes.some(node => node.kind === 'call' && node.properties.calls === 'cache.set'));
  const priceDecision = diff.after.nodes.find(node => node.label === 'Choose price')!;
  assert.equal(priceDecision.properties.condition, "account === 'alpha'");
  assert.deepEqual(diff.after.edges.filter(edge => edge.source === priceDecision.id).map(edge => edge.label).sort(), ['false', 'true']);

  const repaired = extractLogic(source(broken), source(fixed, 'c'.repeat(40)));
  const repairedBranch = repaired.after.nodes.find(node => node.id === branch.id)!;
  assert.equal(repairedBranch.properties.keyExpressions, 'JSON.stringify([account, sku])');
  assert.ok(repaired.changes.some(change => change.id === branch.id && change.change === 'modified'));
  assert.ok(repaired.changes.some(change => change.entity === 'node' && change.change === 'added' && change.id.includes('assign:cacheKey')));
});

test('self, commit-only and whitespace/comment-only comparisons preserve semantic identities', () => {
  const whitespace = fixed.replaceAll('  ', '    ').replaceAll('\n', '\n\n');
  for (const extract of [extractObjects, extractLogic]) {
    assert.equal(changedNodes(extract(source(fixed), source(fixed))).length, 0);
    assert.equal(changedNodes(extract(source(fixed), source(fixed, 'b'.repeat(40)))).length, 0);
    const reformatted = extract(source(fixed), source(`// Format-only change\n${whitespace}`, 'b'.repeat(40)));
    assert.deepEqual(reformatted.changes.filter(change => change.change !== 'unchanged'), []);
  }
});

test('removed nodes and every citation correspond to the actual respective source revision', () => {
  for (const extract of [extractObjects, extractLogic]) {
    const left = source(fixed), right = source(baseline, 'b'.repeat(40));
    const diff = extract(left, right);
    assert.ok(diff.changes.some(change => change.change === 'removed'));
    for (const [snapshot, revision] of [[diff.before, left], [diff.after, right]] as const) {
      const ids = new Set(snapshot.nodes.map(node => node.id));
      assert.equal(ids.size, snapshot.nodes.length);
      assert.ok(snapshot.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
      for (const node of snapshot.nodes) {
        assert.ok(node.citations.length);
        for (const citation of node.citations) {
          assert.equal(citation.sha, revision.sha);
          assert.equal(citation.path, revision.path);
          const lines = revision.content.split('\n').slice(citation.startLine - 1, citation.endLine).join('\n');
          assert.ok(lines.includes(citation.excerpt), `citation must be exact text within its cited lines: ${node.id}`);
        }
      }
    }
  }
});

test('extraction refuses invalid source and never evaluates top-level code', () => {
  const original = (globalThis as Record<string, unknown>).canonicalExtractionExecuted;
  const candidate = `globalThis.canonicalExtractionExecuted = true;\n${fixed}`;
  extractObjects(source(baseline), source(candidate));
  extractLogic(source(baseline), source(candidate));
  assert.equal((globalThis as Record<string, unknown>).canonicalExtractionExecuted, original);
  assert.throws(() => extractObjects(source('export function broken( {'), source(fixed)), /syntactically invalid/);
});

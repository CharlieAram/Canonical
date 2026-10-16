import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtractedNode, LayerDiff } from '@canonical/contracts';
import { flows, layoutFlow } from '../apps/ui/src/lib/review.ts';

const node = (id: string, kind = 'sequence'): ExtractedNode => ({ id, label: `Display ${id}`, kind, description: '', properties: {}, citations: [] });
const layer = (nodes: ExtractedNode[], provenance: LayerDiff['provenance'] = 'model-inference'): LayerDiff => ({
  provenance, before: { nodes: [], edges: [] }, after: { nodes, edges: nodes.length > 1 ? [{ id: 'path', source: nodes[0].id, target: nodes[1].id, label: 'next' }] : [] },
  changes: nodes.map(item => ({ id: item.id, entity: 'node', change: 'added' })), summary: '', limitations: [],
});

test('model logic uses semantic IDs and retains every step even without entry nodes', () => {
  const input = layer([node('validate_quantity', 'branch'), node('return_quote', 'return'), node('separate_step')]);
  const result = flows(input);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].nodes.map(item => item.id), input.after.nodes.map(item => item.id));
  assert.equal(result[0].edges.length, 1);
  assert.equal(result[0].changed, 3);
  assert.ok([...layoutFlow(result[0].nodes, result[0].edges).values()].every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('static flows derive their scope from IDs rather than presentation labels', () => {
  const input = layer([node('logic:quote:entry', 'entry'), node('logic:quote:return', 'return'), node('logic:counter:entry', 'entry')], 'static-analysis');
  const result = flows(input);
  assert.deepEqual(result.map(flow => flow.scope), ['quote', 'counter']);
  assert.equal(result[0].nodes.length, 2);
  assert.equal(result[1].nodes.length, 1);
  assert.deepEqual(flows(layer([])), []);
});

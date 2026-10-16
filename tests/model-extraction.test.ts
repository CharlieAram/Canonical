import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { LayerDiff, RevisionSource } from '@canonical/contracts';
import type { StructuredRequest } from '@canonical/integrations/openai';
import { OpenAIRequestError } from '@canonical/integrations/openai';
import { extractLogic, extractObjects } from '../packages/runner/src/extraction.ts';
import { createModelExtractors, materializeModelLayer, modelLayerJsonSchema, ModelLayerSchema } from '../packages/runner/src/model-extraction.ts';

const source = (content: string, sha = 'a'.repeat(40)): RevisionSource => ({ path: 'src/pricing.mjs', sha, content });
const before = source('export function quote(account, sku) { const cache = new Map(); return cache.get(sku); }');
const after = source('export function quote(account, sku) { const cache = new Map(); return cache.get(account + sku); }', 'b'.repeat(40));
const metadata = { model: 'gpt-5-mini-2025-08-07', responseId: 'resp_test', inputTokens: 120, outputTokens: 60 };
type ModelLayer = z.infer<typeof ModelLayerSchema>;

function payload(facts: LayerDiff): ModelLayer {
  const ids = [...new Set([...facts.before.nodes.map(node => node.id), ...facts.after.nodes.map(node => node.id)])].slice(0, 12);
  return {
    nodes: ids.map((id, index) => ({
      id: `concept_${index}`, label: `Source concept ${index}`, kind: 'concept',
      before: facts.before.nodes.some(node => node.id === id) ? { description: 'Earlier interpretation', properties: [{ name: 'role', value: 'pricing' }], sourceIds: [id] } : null,
      after: facts.after.nodes.some(node => node.id === id) ? { description: 'Rephrased interpretation', properties: [{ name: 'role', value: 'pricing service' }], sourceIds: [id] } : null,
    })),
    edges: [], summary: 'Inferred structure from source.', limitations: ['Only supplied source facts were considered.'],
  };
}

test('model layer preserves exact parser citations and provider metadata, while detecting changed support', () => {
  const facts = extractObjects(before, after);
  const data = payload(facts);
  const result = materializeModelLayer(data, facts, metadata);
  assert.equal(result.provenance, 'model-inference');
  assert.deepEqual(result.model, { provider: 'openai', name: metadata.model, responseId: metadata.responseId, inputTokens: 120, outputTokens: 60 });
  assert.match(result.limitations.join(' '), /does not prove/);
  for (const revision of ['before', 'after'] as const) {
    for (const node of result[revision].nodes) {
      const references = data.nodes.find(item => item.id === node.id)![revision]!.sourceIds;
      const expected = facts[revision].nodes.filter(item => references.includes(item.id)).flatMap(item => item.citations);
      assert.deepEqual(node.citations, expected);
      assert.ok(node.citations.every(citation => citation.sha === (revision === 'before' ? before : after).sha));
    }
  }
  const cacheId = data.nodes.find(node => node.before?.sourceIds.some(id => id.endsWith(':state:cache')))!.id;
  assert.equal(result.changes.find(change => change.id === cacheId)?.change, 'modified');
  assert.equal(Object.hasOwn(result, 'billOfBusiness'), false);
});

test('same AST evidence ignores SHA, lines, formatting, comments, property order and model paraphrasing', () => {
  const moved = source(`// source moved\n\n${before.content.replaceAll(' ', '  ')}`, 'c'.repeat(40));
  for (const extract of [extractObjects, extractLogic]) {
    const facts = extract(before, moved);
    const data = payload(facts);
    const result = materializeModelLayer(data, facts, metadata);
    assert.ok(result.changes.every(change => change.change === 'unchanged'));
    for (const node of result.before.nodes) {
      const candidate = result.after.nodes.find(item => item.id === node.id)!;
      assert.equal(candidate.description, node.description);
      assert.deepEqual(candidate.properties, node.properties);
      assert.notEqual(candidate.citations[0].sha, node.citations[0].sha);
    }
  }
});

test('changed support remains modified even if both generated descriptions and properties match', () => {
  const facts = extractLogic(before, after);
  const data = payload(facts);
  for (const node of data.nodes) if (node.before && node.after) {
    node.after.description = node.before.description;
    node.after.properties = node.before.properties;
  }
  const result = materializeModelLayer(data, facts, metadata);
  assert.ok(result.changes.some(change => change.change === 'modified'));
});

test('rejects hallucinated identifiers, citations, null pairs, duplicate IDs/properties, and cross-revision edges', () => {
  const facts = extractObjects(before, after);
  const checks: Array<(data: ModelLayer) => void> = [
    data => { data.nodes[0].before!.sourceIds = ['fabricated']; },
    data => { data.nodes[0].before!.sourceIds = []; },
    data => { data.nodes[0].before!.sourceIds.push(data.nodes[0].before!.sourceIds[0]); },
    data => { data.nodes.push(structuredClone(data.nodes[0])); },
    data => { data.nodes[0].before = null; data.nodes[0].after = null; },
    data => { data.nodes[0].before!.properties.push({ ...data.nodes[0].before!.properties[0] }); },
    data => { Object.assign(data.nodes[0].after!, { citations: [{ path: '.env', excerpt: 'fabricated' }] }); },
    data => { data.edges.push({ id: 'bad', before: { source: data.nodes[0].id, target: 'absent', label: 'uses' }, after: null }); },
    data => { data.edges.push({ id: 'bad', before: null, after: null }); },
    data => { Object.assign(data, { verdict: 'passed' }); },
    data => { data.nodes[0].id = 'logic:copied_ast_id'; },
    data => { data.nodes = []; },
    data => { for (const node of data.nodes) node.before = null; },
  ];
  for (const mutate of checks) {
    const data = payload(facts);
    mutate(data);
    assert.throws(() => materializeModelLayer(data, facts, metadata));
  }
});

test('self comparison rejects asymmetrical nodes, altered support and inferred edge changes', () => {
  const facts = extractObjects(before, { ...before, sha: 'c'.repeat(40) });
  const data = payload(facts);
  data.nodes[0].before = null;
  assert.throws(() => materializeModelLayer(data, facts, metadata), /identical revision/);
  const changedSupport = payload(facts);
  changedSupport.nodes[0].after!.sourceIds = changedSupport.nodes[1].after!.sourceIds;
  assert.throws(() => materializeModelLayer(changedSupport, facts, metadata), /identical revisions/);
  const changedEdge = payload(facts);
  changedEdge.edges.push({ id: 'edge', before: { source: 'concept_0', target: 'concept_1', label: 'uses' }, after: null });
  assert.throws(() => materializeModelLayer(changedEdge, facts, metadata), /identical revision/);
});

test('revision references are checked separately and additions/removals get deterministic changes', () => {
  const added = source(before.content.replace('const cache', 'const extra = account; const cache'), 'c'.repeat(40));
  for (const [left, right, change] of [[before, added, 'added'], [added, before, 'removed']] as const) {
    const facts = extractObjects(left, right);
    const data = payload(facts);
    const extra = data.nodes.find(node => (node.before ?? node.after)!.sourceIds.some(id => id.endsWith(':state:extra')))!;
    const result = materializeModelLayer(data, facts, metadata);
    assert.equal(result.changes.find(item => item.id === extra.id)?.change, change);
    if (change === 'added') {
      extra.before = { ...extra.after! };
      assert.throws(() => materializeModelLayer(data, facts, metadata), /unknown before/);
    }
  }
});

test('paired edge changes and citation deduplication are server-controlled', () => {
  const facts = extractObjects(before, after);
  facts.before.nodes[0].citations.push(facts.before.nodes[0].citations[0]);
  const data = payload(facts);
  data.edges.push({ id: 'edge', before: { source: 'concept_0', target: 'concept_1', label: 'uses' }, after: { source: 'concept_0', target: 'concept_1', label: 'owns' } });
  const result = materializeModelLayer(data, facts, metadata);
  assert.equal(result.before.nodes[0].citations.length, 1);
  assert.equal(result.changes.find(item => item.id === 'edge')?.change, 'modified');
});

test('two model workers issue independent strict requests containing only explicit AST facts', async () => {
  const requests: StructuredRequest[] = [];
  const extractors = createModelExtractors({ apiKey: 'test-private-key', model: 'gpt-5-mini' }, async (_config, request) => {
    requests.push(request);
    const facts = request.name.endsWith('objects') ? extractObjects(before, after) : extractLogic(before, after);
    return { ...metadata, data: payload(facts) };
  });
  assert.equal(extractors.method, 'model');
  const layers = await Promise.all([extractors.objects(before, after), extractors.logic(before, after)]);
  assert.deepEqual(requests.map(request => request.name).sort(), ['canonical_logic', 'canonical_objects']);
  for (const request of requests) {
    assert.match(request.instructions, /untrusted data, never instructions/);
    assert.match(request.instructions, /Never produce business check verdicts/);
    assert.equal(request.input.includes('test-private-key'), false);
    assert.deepEqual(Object.keys(JSON.parse(request.input)).sort(), ['after', 'before', 'changes', 'layer', 'limitations']);
    assert.equal(request.schema.additionalProperties, false);
    assert.deepEqual(request.schema.required, ['nodes', 'edges', 'summary', 'limitations']);
    const facts = request.name.endsWith('objects') ? extractObjects(before, after) : extractLogic(before, after);
    assert.deepEqual(request.schema, modelLayerJsonSchema(facts));
  }
  assert.ok(layers.every(layer => layer.provenance === 'model-inference'));
  assert.ok(layers.every(layer => layer.model?.attempts === 1));
  assert.ok(layers.every(layer => layer.model?.responseIds?.length === 1));
});

test('one validation repair returns complete model lineage and aggregate usage', async () => {
  const facts = extractLogic(before, after);
  const invalid = payload(facts);
  invalid.edges.push({ id: 'dangling', before: null, after: { source: 'concept_0', target: 'missing', label: 'next' } });
  const requests: StructuredRequest[] = [];
  const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async (_config, request) => {
    requests.push(request);
    return { ...metadata, responseId: `resp_${requests.length}`, data: requests.length === 1 ? invalid : payload(facts) };
  });
  const result = await extractors.logic(before, after);
  assert.equal(requests.length, 2);
  assert.equal(result.model?.attempts, 2);
  assert.deepEqual(result.model?.responseIds, ['resp_1', 'resp_2']);
  assert.equal(result.model?.responseId, 'resp_2');
  assert.equal(result.model?.inputTokens, 240);
  assert.equal(result.model?.outputTokens, 120);
  const repair = JSON.parse(requests[1].input);
  assert.deepEqual(repair.originalFacts, JSON.parse(requests[0].input));
  assert.deepEqual(repair.priorOutput, invalid);
  assert.match(repair.validationReason, /edge references a node absent/);
  assert.match(requests[1].instructions, /single allowed validation repair/);
  assert.deepEqual(requests[1].schema, requests[0].schema);
});

test('repair fails after two invalid outputs, without static fallback or third request', async () => {
  let calls = 0;
  const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async () => {
    calls++;
    return { ...metadata, responseId: `resp_${calls}`, data: { nodes: [], edges: [], summary: 'No evidence', limitations: [] } };
  });
  await assert.rejects(async () => extractors.objects(before, after), /omitted all/);
  assert.equal(calls, 2);
});

test('provider failures are never retried, including a failure during the one validation repair', async () => {
  for (const failureAt of [1, 2]) {
    let calls = 0;
    const providerError = new OpenAIRequestError('http', 429);
    const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async () => {
      calls++;
      if (calls === failureAt) throw providerError;
      return { ...metadata, data: { nodes: [], edges: [], summary: 'Invalid output', limitations: [] } };
    });
    await assert.rejects(async () => extractors.objects(before, after), error => error === providerError);
    assert.equal(calls, failureAt);
  }
});

test('repair does not claim aggregate token totals when any response omitted usage', async () => {
  const facts = extractObjects(before, after);
  let calls = 0;
  const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async () => {
    calls++;
    return { ...metadata, inputTokens: calls === 1 ? undefined : 100, responseId: `resp_${calls}`,
      data: calls === 1 ? { nodes: [], edges: [], summary: 'Invalid output', limitations: [] } : payload(facts) };
  });
  const result = await extractors.objects(before, after);
  assert.equal(result.model?.inputTokens, undefined);
  assert.equal(result.model?.outputTokens, 120);
});

test('validation repair bounds the complete payload before a second provider call', async () => {
  let calls = 0;
  const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async () => {
    calls++;
    return { ...metadata, data: { maliciousExtra: 'x'.repeat(1_000_001) } };
  });
  await assert.rejects(async () => extractors.objects(before, after), /repair exceeds input limit/);
  assert.equal(calls, 1);
});

test('provider schema constrains source IDs to citation-bearing AST evidence in the correct revision', () => {
  const added = source(before.content.replace('const cache', 'const extra = account; const cache'), 'c'.repeat(40));
  const facts = extractObjects(before, added);
  facts.before.nodes[0].citations = [];
  const schema = JSON.parse(JSON.stringify(modelLayerJsonSchema(facts)));
  const node = schema.properties.nodes.items.properties;
  for (const revision of ['before', 'after'] as const) {
    const sourceIds = node[revision].anyOf.find((value: { type: string }) => value.type === 'object').properties.sourceIds;
    assert.deepEqual(sourceIds.items.enum, facts[revision].nodes.filter(fact => fact.citations.length).map(fact => fact.id));
    assert.equal(sourceIds.items.enum.includes('fabricated'), false);
    assert.equal(sourceIds.items.enum.some((id: string) => id.endsWith(':state:extra')), revision === 'after');
    assert.equal(sourceIds.minItems, 1);
  }
  facts.before.nodes = [];
  const withoutBefore = JSON.parse(JSON.stringify(modelLayerJsonSchema(facts)));
  assert.deepEqual(withoutBefore.properties.nodes.items.properties.before, { type: 'null' });
});

test('oversized sources and environment paths fail before any model request; output size is bounded', async () => {
  let calls = 0;
  const extractors = createModelExtractors({ apiKey: 'test', model: 'gpt-5-mini' }, async () => {
    calls++;
    throw new Error('must not call provider');
  });
  await assert.rejects(async () => extractors.objects(source('x'.repeat(100_001)), after), /100,000/);
  await assert.rejects(async () => extractors.logic({ ...before, path: '.env.local' }, after), /Environment files/);
  assert.equal(calls, 0);
  const facts = extractObjects(before, after);
  const data = payload(facts);
  data.nodes[0].after!.description = 'x'.repeat(801);
  assert.throws(() => materializeModelLayer(data, facts, metadata));
});

import type { AnalysisRun, ExtractedNode, LayerDiff } from '@canonical/contracts';
import { milliseconds, variants } from './verdict';

// Presentation over the extracted layer diffs. Suggestions are deterministic rules over
// extracted source facts and executed checks; nothing here is model output or a guess.
export type Change = 'added' | 'removed' | 'modified' | 'unchanged';
export type MergedNode = { id: string; node: ExtractedNode; before?: ExtractedNode; after?: ExtractedNode; change: Change };
export type MergedEdge = { id: string; source: string; target: string; label: string; change: Change };
export type Efficiency = { tone: 'added' | 'failed' | 'neutral'; text: string };
export type Suggestion = { id: string; targetIds: string[]; flow?: string; title: string; detail: string; evidence?: string; backed: boolean };

export function mergeLayer(layer: LayerDiff) {
  const change = (entity: 'node' | 'edge', id: string): Change => layer.changes.find(item => item.entity === entity && item.id === id)?.change ?? 'unchanged';
  const nodes = new Map<string, MergedNode>();
  for (const node of layer.before.nodes) nodes.set(node.id, { id: node.id, node, before: node, change: change('node', node.id) });
  for (const node of layer.after.nodes) nodes.set(node.id, { ...nodes.get(node.id), id: node.id, node, after: node, change: change('node', node.id) });
  const edges = new Map<string, MergedEdge>();
  for (const edge of [...layer.before.edges, ...layer.after.edges]) edges.set(edge.id, { ...edge, change: change('edge', edge.id) });
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// Removed edges only position removed nodes; otherwise the candidate's shape wins.
const layoutEdges = (nodes: MergedNode[], edges: MergedEdge[]) => edges.filter(edge => edge.change !== 'removed' || nodes.find(node => node.id === edge.target)?.change === 'removed');

/** Longest-path depth from the roots; cycles are cut after one pass per node. */
function depths(ids: string[], edges: MergedEdge[]) {
  const depth = new Map(ids.map(id => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const edge of edges) {
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (depth.has(edge.target) && depth.has(edge.source) && next > depth.get(edge.target)! && next < ids.length) { depth.set(edge.target, next); moved = true; }
    }
    if (!moved) break;
  }
  return depth;
}

/** Left to right relation layout; each column is ordered by its parents' positions. */
export function layoutObjects(nodes: MergedNode[], all: MergedEdge[], size: (node: MergedNode) => { w: number; h: number }) {
  const edges = layoutEdges(nodes, all);
  const depth = depths(nodes.map(node => node.id), edges);
  const columns = new Map<number, MergedNode[]>();
  for (const node of nodes) columns.set(depth.get(node.id)!, [...(columns.get(depth.get(node.id)!) ?? []), node]);
  const order = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const key of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(key)!;
    const rank = (node: MergedNode) => { const parents = edges.filter(edge => edge.target === node.id && order.has(edge.source)).map(edge => order.get(edge.source)!); return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0; };
    column.sort((a, b) => rank(a) - rank(b));
    const total = column.reduce((sum, node) => sum + size(node).h + 28, -28);
    let y = -total / 2;
    column.forEach((node, index) => { order.set(node.id, index); positions.set(node.id, { x, y }); y += size(node).h + 28; });
    x += Math.max(...column.map(node => size(node).w)) + 110;
  }
  return positions;
}

export const sideExits = (edges: MergedEdge[]) => edges.filter(edge => edge.label === 'true' && edge.change !== 'removed' && !edges.some(other => other.source === edge.target && other.change !== 'removed'));

/** Top to bottom flowchart: the "no" path continues straight down, "yes" steps aside. */
export function layoutFlow(nodes: MergedNode[], all: MergedEdge[]) {
  const edges = layoutEdges(nodes, all);
  const ids = nodes.map(node => node.id);
  const depth = depths(ids, edges);
  // A "yes" exit that ends the flow sits level with its decision, so the path runs straight across.
  for (const edge of sideExits(edges)) depth.set(edge.target, depth.get(edge.source)!);
  const column = new Map<string, number>();
  const sorted = [...ids].sort((a, b) => depth.get(a)! - depth.get(b)!);
  for (const id of sorted) {
    const incoming = edges.filter(edge => edge.target === id && column.has(edge.source));
    let col = incoming.length ? Math.min(...incoming.map(edge => column.get(edge.source)! + (edge.label === 'true' ? 1 : 0))) : 0;
    while ([...column.entries()].some(([other, c]) => c === col && depth.get(other) === depth.get(id))) col++;
    column.set(id, col);
  }
  // Centre a 56px exit on the 96px decision it leaves from.
  const side = new Set(sideExits(edges).map(edge => edge.target));
  return new Map(ids.map(id => [id, { x: column.get(id)! * 250, y: depth.get(id)! * 120 + (side.has(id) ? 20 : 0) }]));
}

const params = (text = '') => text.split(',').map(item => item.trim().split('=')[0]!.trim()).filter(Boolean);

function failedEvidence(run: AnalysisRun) {
  const failed = variants(run).candidate?.checks.filter(check => check.status === 'failed') ?? [];
  const texts = failed.map(check => run.requirements.find(item => item.id === check.requirementId)?.text ?? check.label);
  return { failed, texts, line: failed.map(check => `${check.label}: expected ${check.expected}, observed ${check.actual}`).join(' · ') };
}

/** A cache keyed on fewer inputs than its caller receives can return another caller's value. */
function keySuggestion(run: AnalysisRun, id: string, targetIds: string[], name: string, keyInputs: string[], inputs: string[], flow?: string): Suggestion | undefined {
  const missing = inputs.filter(input => !keyInputs.includes(input));
  if (!missing.length || !keyInputs.length) return;
  const evidence = failedEvidence(run);
  const named = missing.filter(input => evidence.texts.some(text => text.toLowerCase().includes(input.toLowerCase())));
  return named.length
    ? { id, targetIds, flow, backed: true, title: `Include ${named.join(' and ')} in the ${name} key`, evidence: evidence.line,
      detail: `${name} is keyed on ${keyInputs.join(', ')} only, so a result stored for one ${named[0]} is returned to another. Keying on ${[...keyInputs, ...named].join(' and ')} keeps the speed-up for repeat requests and returns the right value.` }
    : { id, targetIds, flow, backed: false, title: `Check that the ${name} key covers every input`,
      detail: `${name} is keyed on ${keyInputs.join(', ')}, but the caller also receives ${missing.join(', ')}. If the stored value depends on any of them, add it to the key.` };
}

export function objectSuggestions(run: AnalysisRun, layer: LayerDiff): Suggestion[] {
  const { nodes, edges } = mergeLayer(layer);
  return nodes.flatMap(item => {
    if (item.change === 'unchanged' || item.change === 'removed' || item.node.kind !== 'collection') return [];
    const keyInputs = params(item.node.properties.keyInputs);
    return edges.filter(edge => edge.target === item.id && edge.label === 'uses').flatMap(edge => {
      const inputs = nodes.filter(node => node.id.startsWith(`${edge.source}:parameter:`)).map(node => node.node.label);
      const suggestion = keySuggestion(run, `objects:${item.id}:${edge.source}`, [item.id], item.node.label, keyInputs, inputs);
      return suggestion ? [suggestion] : [];
    });
  });
}

export function logicSuggestions(run: AnalysisRun, layer: LayerDiff): Suggestion[] {
  const { nodes } = mergeLayer(layer);
  return nodes.flatMap(item => {
    if (item.change !== 'added' || item.node.kind !== 'branch' || !item.node.properties.keyExpressions) return [];
    const flow = flowOf(item.id);
    const entry = nodes.find(node => node.id === `logic:${flow}:entry`);
    const keyInputs = item.node.properties.keyExpressions.split('|').flatMap(key => key.match(/[A-Za-z_$][\w$]*/g) ?? []).filter(word => !['JSON', 'stringify'].includes(word));
    const name = item.node.properties.calls?.split('.')[0] ?? 'cache';
    const suggestion = keySuggestion(run, `logic:${item.id}`, [item.id], name, [...new Set(keyInputs)], params(entry?.node.properties.parameters), flow);
    return suggestion ? [suggestion] : [];
  });
}

export const flowOf = (id: string) => id.slice('logic:'.length).split(':')[0]!;
export function flows(layer: LayerDiff) {
  const { nodes, edges } = mergeLayer(layer);
  return nodes.filter(node => node.node.kind === 'entry').map(entry => {
    const scope = entry.node.label;
    const inFlow = nodes.filter(node => flowOf(node.id) === scope);
    const ids = new Set(inFlow.map(node => node.id));
    return { scope, nodes: inFlow, edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)), changed: inFlow.filter(node => node.change !== 'unchanged').length };
  });
}

/** Measured once per run; attached to the changes that sit on the measured path. */
export function measured(run: AnalysisRun) {
  const { baseline, candidate } = variants(run);
  if (!baseline || !candidate) return undefined;
  const faster = candidate.benchmark.median < baseline.benchmark.median;
  return { faster, text: `Measured on this run: median ${milliseconds(baseline.benchmark.median)} → ${milliseconds(candidate.benchmark.median)} ms, upstream calls ${baseline.benchmark.upstreamCalls} → ${candidate.benchmark.upstreamCalls}.` };
}

export function objectEfficiency(item: MergedNode, run: AnalysisRun): Efficiency {
  const measure = measured(run);
  if (item.change === 'removed') return { tone: 'neutral', text: 'Removed from the code, so it no longer costs anything at run time.' };
  if (item.node.kind === 'collection') return { tone: measure?.faster ? 'added' : 'neutral', text: `Stores results in memory (${item.node.properties.operations || 'no operations found'}), so repeat requests can skip upstream work. ${measure?.text ?? 'Not measured yet.'}` };
  if (item.node.kind === 'parameter') return { tone: 'neutral', text: 'Adds an input; negligible cost on its own.' };
  if (item.node.kind === 'state') return { tone: 'neutral', text: 'Adds one value held in memory; negligible cost on its own.' };
  return { tone: 'neutral', text: `${item.change === 'added' ? 'New' : 'Changed'} ${item.node.kind}; its cost depends on its callers and was not measured on its own.` };
}

export function logicEfficiency(item: MergedNode, flow: { nodes: MergedNode[]; edges: MergedEdge[] }, run: AnalysisRun): Efficiency {
  const measure = measured(run);
  if (item.change === 'removed') return { tone: 'neutral', text: 'Step removed from this flow.' };
  if (item.node.kind === 'branch') {
    const yes = flow.edges.find(edge => edge.source === item.id && edge.label === 'true');
    const exit = flow.nodes.find(node => node.id === yes?.target);
    if (exit && (exit.node.kind === 'return' || exit.node.kind === 'throw')) {
      const later = reachable(flow.edges, flow.edges.find(edge => edge.source === item.id && edge.label === 'false')?.target);
      const skipped = flow.nodes.filter(node => later.has(node.id) && ['await', 'call', 'operation'].includes(node.node.kind));
      return { tone: measure?.faster ? 'added' : 'neutral', text: `Exits early when true, skipping ${skipped.length ? skipped.map(node => node.node.label.split('(')[0]).join(', ') : 'the rest of the flow'}. ${measure?.text ?? 'Not measured yet.'}` };
    }
    return { tone: 'neutral', text: 'Adds one condition check; negligible cost on its own.' };
  }
  if (item.node.kind === 'await') return { tone: 'failed', text: 'Adds a wait on this path; every request that reaches it pays that latency.' };
  if (item.node.kind === 'call') return { tone: 'neutral', text: `Adds a call to ${item.node.properties.calls ?? 'another function'} on this path.` };
  return { tone: 'neutral', text: `${item.change === 'added' ? 'New' : 'Changed'} step; not measured on its own.` };
}

function reachable(edges: MergedEdge[], from?: string) {
  const seen = new Set<string>();
  const stack = from ? [from] : [];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); edges.filter(edge => edge.source === id && edge.change !== 'removed').forEach(edge => stack.push(edge.target)); }
  return seen;
}

import { useEffect, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, getBezierPath, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import type { Concept, Graph } from '@canonical/contracts';
import { ConceptObject, classify, families } from './ConceptObject';
import type { RequirementStatus } from '../lib/verdict';

type StepData = { concept: Concept; selected: boolean; onSelect: (id: string) => void };
type GrooveData = { label: string; chosen: boolean };

export function StatusPill({ tone, children }: { tone: 'added' | 'modified' | 'failed' | 'duplicate' | 'neutral'; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}><i className={`dot dot-${tone}`} aria-hidden="true" />{children}</span>;
}

function conceptPill(concept: Concept) {
  if (concept.impact === 'failed') return <StatusPill tone="failed">Requirement failed</StatusPill>;
  if (concept.change === 'added') return <StatusPill tone="added">Added</StatusPill>;
  if (concept.change === 'modified') return <StatusPill tone="modified">Modified</StatusPill>;
  if (concept.impact === 'potential') return <StatusPill tone="neutral">Potential impact</StatusPill>;
  return <span className="step-note">Unchanged</span>;
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { concept, selected, onSelect } = data;
  return <>
    <Handle type="target" position={Position.Left} className="step-handle" isConnectable={false} />
    <button className={`step-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(concept.id)}>
      <ConceptObject concept={concept} decorative />
      <span className="step-name"><i className="dot" style={{ background: families[classify(concept).family].base }} aria-hidden="true" />{concept.label}</span>
      {conceptPill(concept)}
    </button>
    <Handle type="source" position={Position.Right} className="step-handle" isConnectable={false} />
  </>;
}

// A pressed groove; the relationship the candidate introduced carries the accent line.
function GrooveEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<GrooveData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <>
    <path d={path} className="groove-light" transform="translate(0 1.4)" />
    <path d={path} className="groove-shade" transform="translate(0 -1)" />
    <BaseEdge path={path} className="groove" />
    {data?.chosen && <path d={path} className="groove-accent" />}
    {data?.label && <EdgeLabelRenderer><span className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data.label}</span></EdgeLabelRenderer>}
  </>;
}

const nodeTypes = { step: StepNode };
const edgeTypes = { groove: GrooveEdge };

export function BusinessGraph({ graph, selectedId, onSelect, requirements }: { graph: Graph; selectedId: string; onSelect: (id: string) => void; requirements: RequirementStatus[] }) {
  const [playing, setPlaying] = useState(false);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const linked = requirements.filter(item => item.requirement.conceptIds.includes(selectedId));

  // "Play flow" steps through concepts left to right; it changes selection only, so it is safe with reduced motion.
  useEffect(() => {
    if (!playing) return;
    const order = [...graph.nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    let index = Math.max(0, order.findIndex(node => node.id === selectedId));
    const timer = setInterval(() => {
      index += 1;
      if (index >= order.length) { setPlaying(false); return; }
      onSelect(order[index]!.id);
    }, 1400);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, graph]);

  const nodes: Node<StepData>[] = graph.nodes.map(concept => ({
    id: concept.id, type: 'step', position: { x: concept.position.x, y: concept.position.y * 1.8 },
    data: { concept, selected: concept.id === selectedId, onSelect }, draggable: false, selectable: false, focusable: false,
  }));
  const edges: Edge<GrooveData>[] = graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'groove', focusable: false, data: { label: edge.label, chosen: edge.change !== 'unchanged' } }));

  return <section className="panel flow-panel" aria-label="Business logic flow">
    <div className="panel-head">
      <div><h2>How the change affects the business</h2><p>Select a concept for its rule and evidence</p></div>
      <div className="panel-tools">
        <ul className="legend" aria-label="Key"><li><i className="dot dot-added" />Added</li><li><i className="dot dot-modified" />Modified</li><li><i className="dot dot-failed" />Requirement failed</li><li><i className="legend-line" />Changed relationship</li></ul>
        <button className="button button-sm" onClick={() => setPlaying(value => !value)} aria-pressed={playing}>{playing ? <><span aria-hidden="true">❚❚</span> Pause</> : <><span aria-hidden="true">▶</span> Play flow</>}</button>
      </div>
    </div>
    <div className="flow-scroll"><div className="flow-canvas fading-grid">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.3} maxZoom={1.2} proOptions={{ hideAttribution: true }} />
    </div></div>
    <span className="provenance">{graph.provenance === 'declared-policy' ? 'Declared policy graph' : 'Declared demo graph'} · not inferred</span>
    {selected && <div className="well detail-well" aria-live="polite">
      <div className="detail-copy"><span className="detail-kicker">Selected: {selected.label}</span><p>{selected.description}</p></div>
      <div className="detail-chips">{linked.length ? linked.map(item => <div className="chip-row" key={item.requirement.id}><span className="chip"><i className={`dot dot-${item.status === 'met' ? 'added' : item.status === 'failed' ? 'failed' : 'modified'}`} aria-hidden="true" />{item.requirement.text}</span><span className="chip-tag">{item.status === 'unverified' ? 'not verified' : item.status}</span></div>) : <p className="muted">No requirement links this concept directly. Downstream impact is not verified.</p>}</div>
    </div>}
  </section>;
}

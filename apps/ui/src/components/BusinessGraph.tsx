import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { Graph } from '@canonical/contracts';

export function BusinessGraph({ graph, selectedId, onSelect }: { graph: Graph; selectedId: string; onSelect: (id: string) => void }) {
  const nodes: Node[] = graph.nodes.map(concept => ({
    id: concept.id, position: concept.position,
    data: { label: <div className="concept-label"><span className="concept-kind">{concept.change === 'unchanged' ? 'Business concept' : concept.change}</span><strong>{concept.label}</strong><span className={`impact impact-${concept.impact}`}>{concept.impact === 'failed' ? 'Requirement failed' : concept.impact === 'potential' ? 'Potential impact' : 'Unchanged'}</span></div> },
    selected: selectedId === concept.id,
    className: `business-node business-node-${concept.impact}`,
    style: { width: 175 },
  }));
  const edges: Edge[] = graph.edges.map(edge => ({ ...edge, animated: edge.change === 'added', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: edge.change === 'added' ? '#b35cf6' : '#8391a3', strokeWidth: 1.5 }, labelStyle: { fill: '#526177', fontSize: 11 } }));
  return <section className="panel graph-panel" aria-label="Business concept graph">
    <div className="panel-heading"><div><span className="eyebrow">Intent map</span><h2>Follow the business impact</h2></div><span className="subtle-tag">{graph.provenance === 'declared-policy' ? 'Declared policy graph' : 'Declared demo graph'}</span></div>
    <div className="graph-canvas"><ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.18 }} onNodeClick={(_, node) => onSelect(node.id)} nodesDraggable={false} nodesConnectable={false} minZoom={0.25} maxZoom={1.5}><Background gap={22} color="#dae1ea" /><Controls showInteractive={false} /></ReactFlow></div>
    <div className="graph-footer"><span><i className="dot purple" /> Changed implementation</span><span><i className="dot red" /> Failed requirement</span><span>Select a concept to inspect its evidence</span></div>
    <div className="concept-picker" aria-label="Select business concept">{graph.nodes.map(node => <button key={node.id} className={node.id === selectedId ? 'selected' : ''} aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>{node.label}</button>)}</div>
  </section>;
}

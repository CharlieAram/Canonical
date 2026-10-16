import { useMemo, useState } from 'react';
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import type { AnalysisRun, LayerDiff } from '@canonical/contracts';
import { ConceptObject } from './ConceptObject';
import { DetailCard, FitOnResize, Recommendations, StatusPill, changeLabel, changeTone, edgeTypes, useDecisions } from './ui';
import { layoutObjects, mergeLayer, objectEfficiency, objectSuggestions, type MergedNode } from '../lib/review';

type ObjectData = { item: MergedNode; selected: boolean; onSelect: (id: string) => void };
const small = (item: MergedNode) => item.node.kind === 'parameter' || item.node.kind === 'field';
const size = (item: MergedNode) => small(item) ? { w: 150, h: 40 } : { w: 150, h: 138 };

function ObjectNode({ data }: NodeProps<Node<ObjectData>>) {
  const { item, selected, onSelect } = data;
  const proposed = item.change !== 'unchanged';
  return <>
    <Handle type="target" position={Position.Left} className="step-handle" isConnectable={false} />
    {small(item)
      ? <button className={`object-chip ${proposed ? `is-proposed is-${item.change}` : ''} ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(item.id)}>{proposed && <i className={`dot dot-${changeTone(item.change)}`} aria-hidden="true" />}{item.node.label}</button>
      : <button className={`step-card object-card ${proposed ? `is-proposed is-${item.change}` : ''} ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(item.id)}>
        <ConceptObject concept={{ id: item.node.kind, label: item.node.label }} size={72} decorative />
        <span className="step-name mono">{item.node.label}</span>
        {proposed ? <StatusPill tone={changeTone(item.change)}>{changeLabel(item.change)}</StatusPill> : <span className="step-note">{item.node.kind}</span>}
      </button>}
    <Handle type="source" position={Position.Right} className="step-handle" isConnectable={false} />
  </>;
}
const nodeTypes = { object: ObjectNode };

export function ObjectsSection({ run, layer }: { run: AnalysisRun; layer: LayerDiff }) {
  const merged = useMemo(() => mergeLayer(layer), [layer]);
  const [selectedId, setSelectedId] = useState('');
  const selected = merged.nodes.find(item => item.id === selectedId);
  const suggestions = useMemo(() => objectSuggestions(run, layer), [run, layer]);
  const store = useDecisions(run.id);
  const positions = useMemo(() => layoutObjects(merged.nodes, merged.edges, size), [merged]);

  const nodes: Node<ObjectData>[] = merged.nodes.map(item => ({ id: item.id, type: 'object', position: positions.get(item.id)!, data: { item, selected: item.id === selectedId, onSelect: (id: string) => setSelectedId(current => current === id ? '' : id) }, draggable: false, selectable: false, focusable: false }));
  const edges: Edge[] = merged.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'groove', focusable: false, data: { label: edge.change === 'unchanged' ? undefined : edge.label, change: edge.change } }));

  return <div className="section-body joined">
    <div className="panel flow-panel">
      <div className="panel-head">
        <div><h2>Object relation graph</h2></div>
        <ul className="legend" aria-label="Key"><li><i className="legend-swatch" />Changed</li><li><i className="dot dot-failed" />Removed</li><li><i className="legend-line" />New relationship</li></ul>
      </div>
      <div className={`diagram-layout ${selected ? 'has-detail' : ''}`}>
        <div>
          <div className="flow-scroll"><div className="flow-canvas object-canvas fading-grid">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.25} maxZoom={1.2} proOptions={{ hideAttribution: true }}><FitOnResize padding={0.1} /></ReactFlow>
          </div></div>
          <span className="provenance">{layer.provenance === 'static-analysis' ? 'Static analysis' : `Model inference${layer.model ? ` · ${layer.model.name}` : ''}`}</span>
        </div>
        {selected && <DetailCard key={selected.id} item={selected} title={selected.node.label} efficiency={selected.change === 'unchanged' ? undefined : objectEfficiency(selected, run)} onClose={() => setSelectedId('')} />}
      </div>
    </div>

    <div className="panel improvements-panel">
      <div className="panel-head"><div><h2>Recommendations</h2><p>Confirm or deny each suggestion, or let auto review decide.</p></div></div>
      <Recommendations section="objects" suggestions={suggestions} store={store} />
    </div>
  </div>;
}

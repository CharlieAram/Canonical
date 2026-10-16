import { useMemo, useState } from 'react';
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import type { AnalysisRun, LayerDiff } from '@canonical/contracts';
import { ConceptObject } from './ConceptObject';
import { ChangeRow, Recommendations, StatusPill, changeLabel, changeTone, edgeTypes, useDecisions } from './ui';
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
  const changed = merged.nodes.filter(item => item.change !== 'unchanged');
  const [selectedId, setSelectedId] = useState(changed[0]?.id ?? '');
  const suggestions = useMemo(() => objectSuggestions(run, layer), [run, layer]);
  const store = useDecisions(run.id);
  const positions = useMemo(() => layoutObjects(merged.nodes, merged.edges, size), [merged]);

  const nodes: Node<ObjectData>[] = merged.nodes.map(item => ({ id: item.id, type: 'object', position: positions.get(item.id)!, data: { item, selected: item.id === selectedId, onSelect: setSelectedId }, draggable: false, selectable: false, focusable: false }));
  const edges: Edge[] = merged.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'groove', focusable: false, data: { label: edge.change === 'unchanged' ? undefined : edge.label, change: edge.change } }));

  return <div className="section-body">
    <div className="panel flow-panel">
      <div className="panel-head">
        <div><h2>Object relation graph</h2><p>{layer.summary} Highlighted objects are what your agent wants to change.</p></div>
        <ul className="legend" aria-label="Key"><li><i className="legend-swatch" />Proposed by agent</li><li><i className="dot dot-failed" />Removed</li><li><i className="legend-line" />New relationship</li></ul>
      </div>
      <div className="flow-scroll"><div className="flow-canvas object-canvas fading-grid">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.25} maxZoom={1.2} proOptions={{ hideAttribution: true }} />
      </div></div>
      <span className="provenance">{layer.provenance === 'static-analysis' ? 'Static analysis of the source' : `Model inference${layer.model ? ` · ${layer.model.name}` : ''} · check the citations`}</span>
    </div>

    <div className="panel">
      <div className="panel-head"><div><h2>Proposed changes</h2><p>Each change your agent made, with its efficiency evaluation.</p></div><span className="count">{changed.length} {changed.length === 1 ? 'change' : 'changes'}</span></div>
      {changed.length ? <ul className="stack">{changed.map(item => <ChangeRow key={item.id} title={item.node.label} kind={item.node.kind} change={item.change} efficiency={objectEfficiency(item, run)} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id === selectedId ? '' : item.id)}>
        <div className="change-detail">
          <p>{item.node.description}</p>
          {!!Object.keys(item.node.properties).length && <dl className="facts">{Object.entries(item.node.properties).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd className="mono">{value}</dd></div>)}</dl>}
          {item.node.citations[0] && <pre className="code-well"><span>{item.node.citations[0].path}:{item.node.citations[0].startLine}</span><code>{item.node.citations[0].excerpt}</code></pre>}
        </div>
      </ChangeRow>)}</ul> : <p className="muted">Your agent did not change any objects in this commit.</p>}
    </div>

    <div className="panel">
      <div className="panel-head"><div><h2>Recommendations</h2><p>Confirm or deny each suggestion, or let auto review decide.</p></div></div>
      <Recommendations section="objects" suggestions={suggestions} store={store} />
    </div>
  </div>;
}

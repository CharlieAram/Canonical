import { useEffect, useMemo, useRef } from 'react';
import { Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import type { AnalysisRun, LayerDiff } from '@canonical/contracts';
import { FitOnResize, StatusPill, changeLabel, changeTone, edgeTypes } from './ui';
import { layoutObjects, mergeLayer, type MergedNode } from '../lib/review';

type ObjectData = { item: MergedNode; selected: boolean; onSelect?: (item: MergedNode) => void };
const properties = (item: MergedNode) => Object.entries(item.node.properties).filter(([, value]) => value.trim());
const size = (item: MergedNode) => ({
  w: 260,
  h: 84 + (properties(item).length ? properties(item).reduce((height, [key, value]) => height + 8 + 22 * Math.max(1, Math.ceil((key.length + value.length + 2) / 34)), 0) : 30),
});

function ObjectNode({ data }: NodeProps<Node<ObjectData>>) {
  const { item, selected, onSelect } = data;
  const changed = item.change !== 'unchanged';
  const fields = properties(item);
  return <>
    <Handle type="target" position={Position.Left} className="step-handle" isConnectable={false} style={{ pointerEvents: 'none' }} />
    <button className={`uml-object ${changed ? `is-proposed is-${item.change}` : ''} ${selected ? 'is-selected' : ''}`} style={{ width: size(item).w, minHeight: size(item).h }} aria-pressed={selected} onClick={() => onSelect?.(item)}>
      <span className="uml-object-header"><strong className="mono"><u>{item.node.label}</u></strong><span className="uml-kind">{item.node.kind}</span></span>
      <span className="uml-properties">{fields.length ? fields.map(([key, value]) => <span className="uml-property" key={key}>
        <span className="uml-property-key">{key}: </span><span className="uml-property-value mono">{value}</span>
      </span>) : <span className="uml-property muted">No recorded properties</span>}</span>
      {changed && <StatusPill tone={changeTone(item.change)}>{changeLabel(item.change)}</StatusPill>}
    </button>
    <Handle type="source" position={Position.Right} className="step-handle" isConnectable={false} style={{ pointerEvents: 'none' }} />
  </>;
}
const nodeTypes = { object: ObjectNode };

interface ObjectsSectionProps {
  run: AnalysisRun;
  layer: LayerDiff;
  selectedId?: string;
  onSelectChange?: (item: MergedNode) => void;
  onContextChange?: (nodes: MergedNode[], label: string) => void;
  onClearSelection?: () => void;
}

export function ObjectsSection({ layer, selectedId = '', onSelectChange, onContextChange }: ObjectsSectionProps) {
  const merged = useMemo(() => mergeLayer(layer), [layer]);
  const changed = merged.nodes.filter(item => item.change !== 'unchanged');
  const contextCallback = useRef(onContextChange);
  useEffect(() => { contextCallback.current = onContextChange; }, [onContextChange]);
  useEffect(() => { contextCallback.current?.(merged.nodes, 'Objects'); }, [merged]);
  const positions = useMemo(() => layoutObjects(merged.nodes, merged.edges, size), [merged]);

  const nodes: Node<ObjectData>[] = merged.nodes.map(item => ({ id: item.id, type: 'object', position: positions.get(item.id)!, style: { width: size(item).w }, data: { item, selected: item.id === selectedId, onSelect: onSelectChange }, draggable: false, selectable: false, focusable: false }));
  const edges: Edge[] = merged.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'groove', focusable: false, data: { label: edge.change === 'unchanged' ? undefined : edge.label, change: edge.change } }));

  return <div className="section-body">
    <div className="panel flow-panel">
      <div className="panel-head">
        <div><h2>Object relation graph</h2></div>
        <ul className="legend" aria-label="Key"><li><i className="legend-swatch" />Changed</li><li><i className="dot dot-failed" />Removed</li><li><i className="legend-line" />New relationship</li></ul>
      </div>
      <div className="flow-scroll"><div className="flow-canvas object-canvas fading-grid">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.1} maxZoom={1.2} proOptions={{ hideAttribution: true }}><FitOnResize padding={0.12} maxZoom={1} /><Controls showInteractive={false} /></ReactFlow>
      </div></div>
      <span className="provenance">{layer.provenance === 'static-analysis' ? 'Static analysis' : `Model inference${layer.model ? ` · ${layer.model.name}` : ''}`}</span>
    </div>

    <div className="panel">
      <div className="panel-head"><div><h2>Changes</h2></div><span className="count">{changed.length} {changed.length === 1 ? 'change' : 'changes'}</span></div>
      {changed.length ? <ul className="stack">{changed.map(item => <li className={`change-row ${item.id === selectedId ? 'is-selected' : ''}`} key={item.id}>
        <button className="change-head" aria-pressed={item.id === selectedId} onClick={() => onSelectChange?.(item)}>
          <span className="change-title"><strong className="mono">{item.node.label}</strong><span>{item.node.kind}</span></span>
          <StatusPill tone={changeTone(item.change)}>{changeLabel(item.change)}</StatusPill>
        </button>
      </li>)}</ul> : <p className="muted">No object changes.</p>}
    </div>

  </div>;
}

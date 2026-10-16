import { useMemo, useState } from 'react';
import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import type { AnalysisRun, LayerDiff } from '@canonical/contracts';
import { DetailCard, FitOnResize, Recommendations, StatusPill, changeLabel, changeTone, edgeTypes, useDecisions } from './ui';
import { flows, layoutFlow, logicEfficiency, logicSuggestions, sideExits, type MergedNode } from '../lib/review';

type StepData = { item: MergedNode; selected: boolean; onSelect: (id: string) => void };
const shape = (kind: string) => kind === 'branch' ? 'decision' : kind === 'entry' || kind === 'return' || kind === 'throw' ? 'terminal' : kind === 'value' ? 'data' : 'process';

// Flowchart symbols: rounded terminals, diamond decisions, process boxes.
function FlowNode({ data }: NodeProps<Node<StepData>>) {
  const { item, selected, onSelect } = data;
  const proposed = item.change !== 'unchanged';
  const label = item.node.kind === 'entry' ? `Start · ${item.node.label.split('.').at(-1)}` : item.node.kind === 'branch' ? item.node.properties.condition ?? item.node.label : item.node.label;
  return <>
    <Handle type="target" position={Position.Top} className="step-handle" isConnectable={false} />
    <Handle id="side" type="target" position={Position.Left} className="step-handle" isConnectable={false} />
    <button className={`flow-node flow-${shape(item.node.kind)} kind-${item.node.kind} ${proposed ? `is-proposed is-${item.change}` : ''} ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(item.id)} title={item.node.label}>
      <span className="flow-shape" aria-hidden="true" />
      <span className="flow-text">{label}</span>
      {proposed && <span className="flow-badge"><i className={`dot dot-${changeTone(item.change)}`} aria-hidden="true" /><span className="sr-only">{changeLabel(item.change)}</span></span>}
    </button>
    <Handle id="next" type="source" position={Position.Bottom} className="step-handle" isConnectable={false} />
    {item.node.kind === 'branch' && <Handle id="yes" type="source" position={Position.Right} className="step-handle" isConnectable={false} />}
  </>;
}
const nodeTypes = { step: FlowNode };
const edgeLabel = (label: string) => label === 'true' ? 'Yes' : label === 'false' ? 'No' : label === 'next' ? undefined : label.replaceAll('_', ' ');

export function LogicSection({ run, layer }: { run: AnalysisRun; layer: LayerDiff }) {
  const list = useMemo(() => flows(layer), [layer]);
  const [scope, setScope] = useState(() => [...list].sort((a, b) => b.changed - a.changed)[0]?.scope ?? '');
  const flow = list.find(item => item.scope === scope) ?? list[0];
  const [selectedId, setSelectedId] = useState('');
  const selected = flow?.nodes.find(item => item.id === selectedId);
  const suggestions = useMemo(() => logicSuggestions(run, layer), [run, layer]);
  const store = useDecisions(run.id);
  const positions = useMemo(() => flow ? layoutFlow(flow.nodes, flow.edges) : new Map(), [flow]);

  if (!flow) return <div className="panel"><p className="muted">No logic flows were extracted from this commit.</p></div>;
  const nodes: Node<StepData>[] = flow.nodes.map(item => ({ id: item.id, type: 'step', position: positions.get(item.id)!, data: { item, selected: item.id === selectedId, onSelect: (id: string) => setSelectedId(current => current === id ? '' : id) }, draggable: false, selectable: false, focusable: false }));
  const side = new Set(sideExits(flow.edges).map(edge => edge.id));
  const edges: Edge[] = flow.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'groove', focusable: false, sourceHandle: edge.label === 'true' ? 'yes' : 'next', ...(side.has(edge.id) ? { targetHandle: 'side' } : {}), data: { label: edgeLabel(edge.label), change: edge.change, step: true } }));
  // Size the canvas to the flow's depth so long flows stay readable instead of shrinking.
  const canvasHeight = Math.min(1240, Math.max(360, Math.max(...[...positions.values()].map(point => point.y)) + 200));

  const flowSuggestions = suggestions.filter(item => item.flow === flow.scope);
  const title = (item: MergedNode) => item.node.kind === 'branch' ? item.node.properties.condition ?? item.node.label : item.node.label;

  return <div className="section-body joined">
    <div className="panel flow-panel logic-panel">
      <nav className="flow-list" aria-label="Logic flows">
        <span className="kicker">{list.length} logic {list.length === 1 ? 'flow' : 'flows'}</span>
        <ul>{list.map(item => <li key={item.scope}><button className={`flow-list-item ${item.scope === flow.scope ? 'is-selected' : ''}`} aria-current={item.scope === flow.scope} onClick={() => { setScope(item.scope); setSelectedId(''); }}>
          <span className="mono">{item.scope}</span>
          <small>{item.nodes.length} steps{item.changed ? ` · ${item.changed} changed` : ''}</small>
          {!!item.changed && <i className="dot dot-failed" aria-hidden="true" />}
        </button></li>)}</ul>
      </nav>
      <div className="flow-main">
        <div className="panel-head">
          <div><h2 className="mono">{flow.scope}</h2></div>
          <ul className="legend" aria-label="Key"><li><i className="legend-swatch" />Changed</li><li><i className="legend-diamond" />Decision</li><li><i className="legend-line" />New path</li></ul>
        </div>
        <div className={`diagram-layout ${selected ? 'has-detail' : ''}`}>
          <div>
            <div className="flow-scroll"><div className="flow-canvas logic-canvas fading-grid" style={{ height: canvasHeight }}>
              <ReactFlow key={flow.scope} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} minZoom={0.25} maxZoom={1.2} proOptions={{ hideAttribution: true }}><FitOnResize padding={0.12} maxZoom={1} /></ReactFlow>
            </div></div>
            <span className="provenance">{layer.provenance === 'static-analysis' ? 'Static analysis' : `Model inference${layer.model ? ` · ${layer.model.name}` : ''}`}</span>
          </div>
          {selected && <DetailCard key={selected.id} item={selected} title={title(selected)} efficiency={selected.change === 'unchanged' ? undefined : logicEfficiency(selected, flow, run)} onClose={() => setSelectedId('')} />}
        </div>
      </div>
    </div>

    <div className="panel improvements-panel">
      <div className="panel-head"><div><h2>Improvement suggestions</h2><p>Confirm or deny each suggestion, or let auto review decide.</p></div>{suggestions.length > flowSuggestions.length && <StatusPill tone="canonical">{suggestions.length - flowSuggestions.length} in other flows</StatusPill>}</div>
      <Recommendations section="logic" suggestions={flowSuggestions} store={store} />
    </div>
  </div>;
}

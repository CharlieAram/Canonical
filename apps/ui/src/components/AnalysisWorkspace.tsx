import { useCallback, useMemo, useState } from 'react';
import type { AnalysisRun } from '@canonical/contracts';
import { mergeLayer, type MergedNode } from '../lib/review';
import { ObjectsSection } from './ObjectsSection';
import { LogicSection } from './LogicSection';
import { BusinessSidebar } from './BusinessSidebar';
import { ChangeDrawer } from './ChangeDrawer';

type Tab = 'objects' | 'logic';
export function AnalysisWorkspace({ run }: { run: AnalysisRun }) {
  const [tab, setTab] = useState<Tab>('objects');
  const [changeId, setChangeId] = useState('');
  const [context, setContext] = useState<{ nodes: MergedNode[]; label: string }>({ nodes: [], label: 'Objects' });
  const layer = run.review?.[tab];
  const merged = useMemo(() => layer ? mergeLayer(layer) : { nodes: [], edges: [] }, [layer]);
  const change = merged.nodes.find(item => item.id === changeId);
  const onContextChange = useCallback((nodes: MergedNode[], label: string) => setContext({ nodes, label }), []);
  const onSelectChange = useCallback((item: MergedNode) => setChangeId(item.id), []);
  const onClearSelection = useCallback(() => setChangeId(''), []);
  function chooseTab(next: Tab) { setTab(next); setChangeId(''); setContext({ nodes: [], label: next === 'objects' ? 'Objects' : 'Logic' }); }
  const agent = run.review?.agents.find(item => item.id === tab);
  return <>
    <div className={`analysis-workspace${change ? ' has-change-drawer' : ''}`}>
      <BusinessSidebar run={run} nodes={change ? [change] : context.nodes.length ? context.nodes : merged.nodes} contextLabel={change?.node.label ?? context.label} />
      <div className="analysis-content">
        <div className="analysis-tabs" role="tablist" aria-label="Analysis layers">{(['objects', 'logic'] as const).map(item => <button key={item} id={`tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => chooseTab(item)} onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); const next = event.key === 'Home' ? 'objects' : event.key === 'End' ? 'logic' : tab === 'objects' ? 'logic' : 'objects';
            chooseTab(next); document.getElementById(`tab-${next}`)?.focus();
          }
        }}>{item === 'objects' ? 'Objects' : 'Logic'}</button>)}</div>
        <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {layer ? tab === 'objects'
            ? <ObjectsSection key={`${run.id}:objects`} run={run} layer={layer} selectedId={changeId} onSelectChange={onSelectChange} onContextChange={onContextChange} onClearSelection={onClearSelection} />
            : <LogicSection key={`${run.id}:logic`} run={run} layer={layer} selectedId={changeId} onSelectChange={onSelectChange} onContextChange={onContextChange} onClearSelection={onClearSelection} />
            : <div className="panel empty-state compact" role="status">{agent?.status === 'error' ? agent.message : agent?.status === 'running' || agent?.status === 'queued' ? `Analyzing ${tab}…` : `No ${tab} layer available for this review.`}</div>}
        </section>
      </div>
    </div>
    {change && <ChangeDrawer change={change} onClose={onClearSelection} />}
  </>;
}

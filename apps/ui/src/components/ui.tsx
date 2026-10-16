import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useReactFlow, type Edge, type EdgeProps } from '@xyflow/react';
import type { Change, Efficiency, MergedNode, Suggestion } from '../lib/review';

export type Tone = 'added' | 'modified' | 'failed' | 'neutral' | 'canonical';
// Every agent change reads red; unchanged stays neutral.
export const changeTone = (change: Change): Tone => change === 'unchanged' ? 'neutral' : 'failed';
export const changeLabel = (change: Change) => change === 'added' ? 'Added by agent' : change === 'modified' ? 'Changed by agent' : change === 'removed' ? 'Removed by agent' : 'Unchanged';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}><i className={`dot dot-${tone}`} aria-hidden="true" />{children}</span>;
}

type GrooveData = { label?: string; change: Change; step?: boolean };
// A pressed groove; relationships the agent added carry the accent line.
export function GrooveEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<GrooveData>>) {
  const [path, labelX, labelY] = data?.step
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const removed = data?.change === 'removed';
  return <>
    {!removed && <path d={path} className="groove-light" transform="translate(0 1.4)" />}
    {!removed && <path d={path} className="groove-shade" transform="translate(0 -1)" />}
    <BaseEdge path={path} className={removed ? 'groove groove-removed' : 'groove'} />
    {(data?.change === 'added' || data?.change === 'modified') && <path d={path} className="groove-accent" />}
    {data?.label && <EdgeLabelRenderer><span className={`edge-label ${removed ? 'is-removed' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data.label}</span></EdgeLabelRenderer>}
  </>;
}
export const edgeTypes = { groove: GrooveEdge };

/** Re-fits a diagram when its canvas changes size, e.g. when the detail card opens. */
export function FitOnResize({ padding, maxZoom }: { padding: number; maxZoom?: number }) {
  const { fitView } = useReactFlow();
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = marker.current?.closest('.react-flow');
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    let first = true;
    const observer = new ResizeObserver(() => { if (first) { first = false; return; } void fitView({ padding, maxZoom, duration: 320 }); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitView, padding, maxZoom]);
  return <span ref={marker} hidden />;
}

/** Details for one clicked node: what the agent changed, its efficiency and its source. */
export function DetailCard({ item, title, efficiency, onClose }: { item: MergedNode; title: string; efficiency?: Efficiency; onClose: () => void }) {
  const citation = item.node.citations[0];
  const properties = Object.entries(item.node.properties).filter(([, value]) => value);
  return <aside className="detail-card" aria-label={`Details for ${title}`} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div className="detail-card-head">
      <div><h3>{title}</h3><p>{item.node.kind}</p></div>
      <button className="detail-close" aria-label="Close details" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
    </div>
    <StatusPill tone={changeTone(item.change)}>{changeLabel(item.change)}</StatusPill>
    <p className="muted">{item.node.description}</p>
    {efficiency && <div className="detail-section"><span className="detail-label">Efficiency</span><p className={`efficiency ${efficiency.tone === 'neutral' ? '' : `text-${efficiency.tone}`}`}>{efficiency.text}</p></div>}
    {!!properties.length && <div className="detail-section"><span className="detail-label">Source facts</span><dl className="facts">{properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd className="mono">{value}</dd></div>)}</dl></div>}
    {citation && <div className="detail-section"><span className="detail-label">Source</span><pre className="code-well"><span>{citation.path}:{citation.startLine}</span><code>{citation.excerpt}</code></pre></div>}
  </aside>;
}

export type Decision = { value: 'confirmed' | 'denied'; auto?: boolean };
/** Review decisions are kept per viewer in this browser; nothing is sent to the agent from here. */
export function useDecisions(runId: string) {
  const key = `canonical:decisions:${runId}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') as { decisions?: Record<string, Decision>; auto?: Record<string, boolean> }; } catch { return {}; } };
  const [state, setState] = useState(read);
  useEffect(() => setState(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: typeof state) => { setState(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Storage can be unavailable; decisions still apply for this view. */ } };
  return {
    decisions: state.decisions ?? {}, auto: state.auto ?? {},
    decide: (id: string, decision?: Decision) => { const decisions = { ...state.decisions }; if (decision) decisions[id] = decision; else delete decisions[id]; save({ ...state, decisions }); },
    setAuto: (section: string, on: boolean, suggestions: Suggestion[]) => {
      const decisions = { ...state.decisions };
      // Auto review confirms only suggestions backed by a failed executable check.
      if (on) suggestions.filter(item => item.backed && !decisions[item.id]).forEach(item => { decisions[item.id] = { value: 'confirmed', auto: true }; });
      save({ decisions, auto: { ...state.auto, [section]: on } });
    },
  };
}

export function Recommendations({ section, suggestions, store }: { section: string; suggestions: Suggestion[]; store: ReturnType<typeof useDecisions> }) {
  const auto = !!store.auto[section];
  return <div className="recommendations">
    <div className="well auto-box">
      <div><strong>Auto review</strong><p>{auto ? 'On. Suggestions backed by a failed executable check are confirmed automatically; the rest wait for you.' : 'Off. Every suggestion waits for you to confirm or deny it.'}</p></div>
      <label className="switch"><input type="checkbox" role="switch" checked={auto} onChange={event => store.setAuto(section, event.target.checked, suggestions)} /><span className="switch-track" aria-hidden="true" />Run automatically</label>
    </div>
    {suggestions.length ? <ul className="stack">{suggestions.map(item => {
      const decision = store.decisions[item.id];
      return <li key={item.id} className={`recommendation ${decision ? `is-${decision.value}` : ''}`}>
        <div className="recommendation-copy">
          <span className="kicker">Recommendation{item.backed ? ' · backed by a failed check' : ' · rule-based, not verified'}</span>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
          {item.evidence && <p className="evidence"><i className="dot dot-failed" aria-hidden="true" />{item.evidence}</p>}
        </div>
        <div className="decision">
          {decision ? <><StatusPill tone={decision.value === 'confirmed' ? 'added' : 'neutral'}>{decision.value === 'confirmed' ? (decision.auto ? 'Confirmed automatically' : 'Confirmed') : 'Denied'}</StatusPill><button className="button button-sm" onClick={() => store.decide(item.id)}>Undo</button></>
          : <><button className="button button-sm" onClick={() => store.decide(item.id, { value: 'denied' })}>Deny</button><button className="button button-sm button-primary" onClick={() => store.decide(item.id, { value: 'confirmed' })}>Confirm</button><button className="button button-sm" aria-pressed={auto} onClick={() => store.setAuto(section, !auto, suggestions)}>Auto</button></>}
        </div>
      </li>;
    })}</ul> : <p className="muted">No suggestions for this change. Canonical's rules found nothing to improve.</p>}
  </div>;
}

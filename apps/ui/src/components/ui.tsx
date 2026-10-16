import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { Change, Efficiency, Suggestion } from '../lib/review';

export type Tone = 'added' | 'modified' | 'failed' | 'neutral' | 'canonical';
export const changeTone = (change: Change): Tone => change === 'added' ? 'added' : change === 'modified' ? 'modified' : change === 'removed' ? 'failed' : 'neutral';
export const changeLabel = (change: Change) => change === 'added' ? 'Added by agent' : change === 'modified' ? 'Changed by agent' : change === 'removed' ? 'Removed by agent' : 'Unchanged';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}><i className={`dot dot-${tone}`} aria-hidden="true" />{children}</span>;
}

/** Fades and lifts content in once as it scrolls into view. */
export function Reveal({ children, className = '', as: Tag = 'div', id }: { children: ReactNode; className?: string; as?: 'div' | 'section'; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setShown(true); observer.disconnect(); } }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref as never} id={id} className={`reveal ${shown ? 'is-shown' : ''} ${className}`}>{children}</Tag>;
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

export function ChangeRow({ title, kind, change, efficiency, selected, onSelect, children }: { title: string; kind: string; change: Change; efficiency: Efficiency; selected: boolean; onSelect: () => void; children?: ReactNode }) {
  return <li className={`change-row ${selected ? 'is-selected' : ''}`}>
    <button className="change-head" aria-expanded={selected} onClick={onSelect}>
      <span className="change-title"><strong className="mono">{title}</strong><span>{kind}</span></span>
      <StatusPill tone={changeTone(change)}>{changeLabel(change)}</StatusPill>
    </button>
    <p className="efficiency"><span className={`efficiency-tag text-${efficiency.tone}`}>Efficiency</span>{efficiency.text}</p>
    {selected && children}
  </li>;
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

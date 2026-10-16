import type { ReactNode } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { Change } from '../lib/review';

export type Tone = 'added' | 'modified' | 'failed' | 'neutral' | 'canonical';
export const changeTone = (change: Change): Tone => change === 'added' ? 'added' : change === 'modified' ? 'modified' : change === 'removed' ? 'failed' : 'neutral';
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

export function ChangeRow({ title, kind, change, selected, onSelect, children }: { title: string; kind: string; change: Change; selected: boolean; onSelect: () => void; children?: ReactNode }) {
  return <li className={`change-row ${selected ? 'is-selected' : ''}`}>
    <button className="change-head" aria-expanded={selected} onClick={onSelect}>
      <span className="change-title"><strong className="mono">{title}</strong><span>{kind}</span></span>
      <StatusPill tone={changeTone(change)}>{changeLabel(change)}</StatusPill>
    </button>
    {selected && children}
  </li>;
}

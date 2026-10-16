import type { AnalysisRun } from '@canonical/contracts';
import type { MergedNode } from '../lib/review';
import { businessEntries, businessRelevance } from '../lib/business-relevance';

export function BusinessSidebar({ run, nodes, contextLabel }: { run: AnalysisRun; nodes: MergedNode[]; contextLabel: string }) {
  return <aside className="bob-panel" aria-label="Bill of business">
    <div className="bob-heading"><span className="kicker">BOB</span><h2>Bill of business</h2></div>
    <p className="bob-context">{contextLabel}</p>
    <ul className="bob-list">{businessEntries(run).map(entry => {
      const relevance = businessRelevance(entry.id, nodes);
      const muted = relevance === 'unrelated';
      const status = entry.status === 'failed' ? 'Conflict' : entry.status === 'passed' ? 'Satisfied' : entry.status === 'error' ? 'Not evaluated' : 'Pending';
      return <li key={entry.id} className={`bob-item bob-${entry.status}${muted ? ' is-irrelevant' : ''}`} title={muted ? 'Not relevant to this selection' : relevance === 'unknown' ? 'Relevance not mapped; recorded result shown' : 'Related to this selection'}>
        <span className="bob-symbol" aria-label={muted ? `Not relevant · ${status}` : status}>{entry.status === 'passed' ? '✓' : entry.status === 'failed' ? '✕' : entry.status === 'error' ? '?' : '◷'}</span>
        <div><p className="bob-text">{entry.text}</p><small className="bob-status">{muted ? 'Not relevant' : status}</small>
          {!muted && entry.status === 'failed' && entry.evidence.filter(item => item.variant === 'candidate' && item.status === 'failed').map(item => <small className="bob-evidence" key={'checkId' in item ? item.checkId : item.id}>{item.actual}</small>)}
        </div>
      </li>;
    })}</ul>
    <p className="bob-footnote">Dimmed by source context. Recorded results stay unchanged.</p>
  </aside>;
}

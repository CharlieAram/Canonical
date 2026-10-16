import type { AnalysisRun, ApprovedContext } from '@canonical/contracts';
import { StatusPill } from './BusinessGraph';

export function EvidencePanel({ run, conceptId, approvals = [] }: { run: AnalysisRun; conceptId: string; approvals?: ApprovedContext[] }) {
  const concept = run.graph.nodes.find(node => node.id === conceptId);
  const checks = run.results.flatMap(result => result.checks.filter(check => check.conceptIds.includes(conceptId)).map(check => ({ ...check, variant: result.variant })));
  return <section className="panel evidence-panel" aria-label="Executable evidence">
    <div className="panel-head"><div><h2>Executable evidence</h2><p>{concept ? `Checks that exercise ${concept.label}` : 'Select a concept'}</p></div></div>
    {checks.length ? <div className="stack">{checks.map(check => <article className={`well check ${check.status === 'failed' ? 'check-failed' : ''}`} key={`${check.variant}-${check.id}`}>
      <div className="check-head"><strong>{check.label}</strong><StatusPill tone={check.status === 'failed' ? 'failed' : 'added'}>{check.variant === 'baseline' ? 'Baseline' : 'Candidate'} · {check.status}</StatusPill></div>
      <dl><div><dt>Expected</dt><dd>{check.expected}</dd></div><div><dt>Observed</dt><dd>{check.actual}</dd></div></dl>
      {check.variant === 'candidate' && approvals.filter(item => item.requirementId === check.requirementId).map(item => <div className="reviewed-citation" key={item.id}>
        <span className="kicker">Reviewed supporting context · v{item.version}</span>
        <p className="citation-rule">{item.requirementText}</p>
        <blockquote className="source-quote"><p>{item.quote}</p><cite>{item.source.title} · {item.source.kind} · line {item.segment.line}{item.segment.timestamp ? ` · ${item.segment.timestamp}` : ''}{item.segment.speaker ? ` · ${item.segment.speaker}` : ''}</cite></blockquote>
        <p>Approved by {item.reviewer} on {new Date(item.approvedAt).toLocaleString('en-GB')}. Added after execution; not original CI input.</p>
        {item.source.sourceUrl && <a href={item.source.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
      </div>)}
    </article>)}</div> : <p className="muted">{run.status === 'completed' ? 'No executable checks target this concept in v0.' : 'Evidence appears as the evaluation completes.'}</p>}
  </section>;
}

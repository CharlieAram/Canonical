import type { AnalysisRun, ApprovedContext } from '@canonical/contracts';

export function EvidencePanel({ run, conceptId, approvals = [] }: { run: AnalysisRun; conceptId: string; approvals?: ApprovedContext[] }) {
  const concept = run.graph.nodes.find(node => node.id === conceptId);
  const requirements = run.requirements.filter(item => item.conceptIds.includes(conceptId));
  const checks = run.results.flatMap(result => result.checks.filter(check => check.conceptIds.includes(conceptId)).map(check => ({ ...check, variant: result.variant })));
  return <section className="panel evidence-panel"><div className="panel-heading"><div><span className="eyebrow">Evidence inspector</span><h2>{concept?.label ?? 'Select a concept'}</h2></div><span className={`status ${concept?.impact === 'failed' ? 'status-error' : 'status-neutral'}`}>{concept?.impact ?? 'none'}</span></div>
    <p className="concept-description">{concept?.description}</p>
    <h3>Approved requirements</h3>
    {requirements.length ? <ul className="requirements">{requirements.map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p className="muted">No directly linked requirement. Downstream impact is unverified.</p>}
    <h3>Executable evidence</h3>
    {checks.length ? <div className="checks">{checks.map(check => <article className={`check check-${check.status}`} key={`${check.variant}-${check.id}`}><div className="check-heading"><span className="variant">{check.variant}</span><span className={`status ${check.status === 'failed' ? 'status-error' : 'status-success'}`}>{check.status}</span></div><strong>{check.label}</strong><dl><div><dt>Expected</dt><dd>{check.expected}</dd></div><div><dt>Observed</dt><dd>{check.actual}</dd></div></dl>{check.variant === 'candidate' && approvals.filter(item => item.requirementId === check.requirementId).map(item => <div className="reviewed-citation" key={item.id}><span className="eyebrow">Reviewed supporting context · v{item.version}</span><p className="citation-rule">{item.requirementText}</p><blockquote className="source-quote"><p>{item.quote}</p><cite>{item.source.title} · {item.source.kind} · line {item.segment.line}{item.segment.timestamp ? ` · ${item.segment.timestamp}` : ''}{item.segment.speaker ? ` · ${item.segment.speaker}` : ''}</cite></blockquote><p>Approved by {item.reviewer} on {new Date(item.approvedAt).toLocaleString()}. Added after execution; not original CI input.</p>{item.source.sourceUrl && <a href={item.source.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}</div>)}</article>)}</div> : <p className="muted">{run.status === 'completed' ? 'No executable checks target this concept in v0.' : 'Evidence appears as evaluation completes.'}</p>}
  </section>;
}

import type { AnalysisRun, ExtractedNode, LayerDiff } from '@canonical/contracts';
import { StatusPill } from './BusinessGraph';

type Tone = 'added' | 'modified' | 'failed' | 'neutral';
const tone = (status: string): Tone => status === 'passed' || status === 'completed' || status === 'added' ? 'added'
  : status === 'failed' || status === 'error' || status === 'removed' ? 'failed'
  : status === 'running' || status === 'modified' ? 'modified' : 'neutral';
const methodLabel = { 'static-analysis': 'Static analysis', model: 'Model inference', daytona: 'Daytona execution' };
const verdictIcon = (status: string) => status === 'passed' ? '✓' : status === 'failed' ? '✕' : status === 'error' ? '?' : '◷';

export function ReviewPipeline({ run }: { run: AnalysisRun }) {
  const review = run.review;
  if (!review) return null;
  const finished = review.agents.filter(agent => agent.status === 'completed' || agent.status === 'error').length;
  return <section className="panel" aria-label="Commit review progress">
    <div className="panel-head"><div><h2>Commit review</h2><p>{finished} of {review.agents.length} tasks finished · update {review.sequence}</p></div>
      {review.trigger?.url && /^https?:\/\//.test(review.trigger.url) && <a href={review.trigger.url} target="_blank" rel="noreferrer">Open CI run ↗</a>}
    </div>
    <div className="stack" aria-live="polite">{review.agents.map(agent => <article className="well" key={agent.id}>
      <div className="check-head"><strong>{agent.label}</strong><StatusPill tone={tone(agent.status)}>{agent.status}</StatusPill></div>
      <p className="muted">{methodLabel[agent.method]}</p><p>{agent.message}</p>
    </article>)}</div>
    {!!review.events.length && <details style={{ marginTop: 12 }}><summary>Progress history · {review.events.length} events</summary>
      <ol>{review.events.map(event => <li key={event.sequence}><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time> · {event.message}</li>)}</ol>
    </details>}
  </section>;
}

function NodeDetails({ node, revision }: { node?: ExtractedNode; revision: string }) {
  return <div className="well" style={{ minWidth: 0 }}>
    <span className="kicker">{revision}</span>
    {node ? <><h3>{node.label}</h3><p className="muted">{node.kind}</p><p>{node.description}</p>
      {!!Object.keys(node.properties).length && <dl>{Object.entries(node.properties).map(([key, value]) => <div key={key}><dt>{key}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd></div>)}</dl>}
      {node.citations.map((citation, index) => <details key={`${citation.sha}-${citation.path}-${citation.startLine}-${index}`} style={{ marginTop: 8 }}>
        <summary style={{ overflowWrap: 'anywhere' }}>{citation.path}:{citation.startLine}{citation.endLine !== citation.startLine ? `–${citation.endLine}` : ''} · {citation.sha.slice(0, 8)}</summary>
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>Commit {citation.sha}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><code>{citation.excerpt}</code></pre>
      </details>)}
      {!node.citations.length && <p className="muted">No source citation supplied.</p>}
    </> : <p className="muted">Not present in this revision.</p>}
  </div>;
}

const columns = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 };

export function LayerDiffView({ layer, title }: { layer?: LayerDiff; title: string }) {
  if (!layer) return <section className="panel" aria-label={title}><h2>{title}</h2><p className="muted">No layer result is available yet. Check the extraction task status above.</p></section>;
  const nodeIds = [...new Set([...layer.before.nodes, ...layer.after.nodes].map(node => node.id))];
  const edgeIds = [...new Set([...layer.before.edges, ...layer.after.edges].map(edge => edge.id))];
  function changeFor(entity: 'node' | 'edge', id: string, before: unknown, after: unknown) {
    return layer!.changes.find(change => change.entity === entity && change.id === id)?.change
      ?? (!before ? 'added' : !after ? 'removed' : 'unchanged');
  }
  return <section className="panel" aria-label={title}>
    <div className="panel-head"><div><h2>{title}</h2><p>{layer.provenance === 'model-inference' ? `Model inference${layer.model ? ` · ${layer.model.name}` : ''} · inspect source citations` : 'Static analysis · source-backed extraction'}</p></div></div>
    <p>{layer.summary}</p>
    {!!layer.limitations.length && <details style={{ margin: '12px 0' }}><summary>Scope and limitations</summary><ul>{layer.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
    <div className="stack">{nodeIds.map(id => {
      const before = layer.before.nodes.find(node => node.id === id);
      const after = layer.after.nodes.find(node => node.id === id);
      const change = changeFor('node', id, before, after);
      return <article key={id} aria-label={`${after?.label ?? before?.label}: ${change}`}>
        <div className="check-head" style={{ marginBottom: 8 }}><strong>{after?.label ?? before?.label}</strong><StatusPill tone={tone(change)}>{change}</StatusPill></div>
        <div style={columns}><NodeDetails node={before} revision="Baseline" /><NodeDetails node={after} revision="Candidate" /></div>
      </article>;
    })}</div>
    {!nodeIds.length && <p className="muted">No entities were extracted in this layer.</p>}
    {!!edgeIds.length && <div style={{ marginTop: 18 }}><h3>Relationships</h3><div className="stack">{edgeIds.map(id => {
      const before = layer.before.edges.find(edge => edge.id === id);
      const after = layer.after.edges.find(edge => edge.id === id);
      const change = changeFor('edge', id, before, after);
      return <article className="well" key={id}><div className="check-head"><strong>{after?.label ?? before?.label}</strong><StatusPill tone={tone(change)}>{change}</StatusPill></div>
        <div style={columns}>{(['before', 'after'] as const).map(side => {
          const edge = side === 'before' ? before : after;
          const nodes = layer[side].nodes;
          const name = (nodeId: string) => nodes.find(node => node.id === nodeId)?.label ?? nodeId;
          return <div key={side}><span className="kicker">{side === 'before' ? 'Baseline' : 'Candidate'}</span><p>{edge ? `${name(edge.source)} → ${edge.label} → ${name(edge.target)}` : 'Not present in this revision.'}</p></div>;
        })}</div>
      </article>;
    })}</div></div>}
  </section>;
}

export function BillOfBusiness({ run }: { run: AnalysisRun }) {
  const entries = run.review?.billOfBusiness;
  if (!entries) return null;
  return <section className="panel" aria-label="Bill of business">
    <div className="panel-head"><div><h2>Bill of business</h2><p>Approved requirements and executed evidence for both revisions.</p></div></div>
    <div className="stack">{entries.map(entry => <article className="well" key={entry.id}>
      <div className="check-head"><strong>{entry.text}</strong><StatusPill tone={tone(entry.status)}><span aria-hidden="true">{verdictIcon(entry.status)}</span> {entry.status}</StatusPill></div>
      <p className="muted">{entry.id}</p>
      <div style={columns}>{(['baseline', 'candidate'] as const).map(variant => {
        const status = variant === 'baseline' ? entry.baselineStatus : entry.candidateStatus;
        const evidence = entry.evidence.filter(item => item.variant === variant);
        return <div key={variant}><StatusPill tone={tone(status)}><span aria-hidden="true">{verdictIcon(status)}</span> {variant === 'baseline' ? 'Baseline' : 'Candidate'} · {status}</StatusPill>
          {evidence.map(item => <div key={item.checkId}><dl><div><dt>Expected</dt><dd>{item.expected}</dd></div><div><dt>Observed</dt><dd>{item.actual}</dd></div></dl>{item.commitSha && <p className="muted" title={item.commitSha}>Commit {item.commitSha.slice(0, 8)}</p>}</div>)}
          {!evidence.length && <p className="muted">{status === 'error' ? 'Execution did not establish an outcome.' : 'Waiting for executed evidence.'}</p>}
        </div>;
      })}</div>
    </article>)}</div>
  </section>;
}

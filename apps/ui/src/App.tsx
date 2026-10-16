import { useEffect, useRef, useState } from 'react';
import type { AnalysisRun, Health } from '@canonical/contracts';
import { api, isFixture } from './lib/api';
import { mergeRunSnapshots } from './lib/run-state';
import { AnalysisWorkspace } from './components/AnalysisWorkspace';
import { StatusPill, type Tone } from './components/ui';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const routeId = () => {
  const match = window.location.hash.match(/^#\/commits\/([^/]+)$/);
  try { return match ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
};
const tone = (status: string): Tone => status === 'failed' || status === 'error' ? 'failed' : status === 'passed' || status === 'completed' ? 'added' : 'neutral';
function entries(run: AnalysisRun) {
  return run.review?.billOfBusiness ?? run.requirements.map(rule => {
    const check = run.results.find(result => result.variant === 'candidate')?.checks.find(check => check.requirementId === rule.id);
    return { id: rule.id, text: rule.text, status: check?.status ?? (run.status === 'error' ? 'error' : 'pending') };
  });
}
function verdict(run: AnalysisRun) {
  if (run.status === 'error') return { label: 'Analysis incomplete', tone: 'failed' as const };
  if (run.status !== 'completed') return { label: 'Analyzing', tone: 'canonical' as const };
  const checks = entries(run);
  const failed = checks.filter(check => check.status === 'failed').length;
  if (failed) return { label: `${failed} ${failed === 1 ? 'check' : 'checks'} failed`, tone: 'failed' as const };
  const passed = checks.filter(check => check.status === 'passed').length;
  return { label: passed === checks.length && passed ? `${passed} checks passed` : 'Review ready', tone: passed === checks.length && passed ? 'added' as const : 'neutral' as const };
}

export function App() {
  const [health, setHealth] = useState<Health>();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const runsRef = useRef<AnalysisRun[]>([]);
  const [selectedId, setSelectedId] = useState(routeId);
  const [error, setError] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const selected = runs.find(run => run.id === selectedId);
  function applyRuns(incoming: AnalysisRun[]) {
    const merged = mergeRunSnapshots(runsRef.current, incoming);
    runsRef.current = merged;
    setRuns(merged);
  }
  useEffect(() => {
    const change = () => { setSelectedId(routeId()); setError(''); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([api.health(controller.signal), api.listRuns(controller.signal)]).then(([nextHealth, nextRuns]) => {
      if (controller.signal.aborted) return;
      setHealth(nextHealth); applyRuns(nextRuns);
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!health || isFixture) return;
    return api.subscribeRuns(nextRuns => { applyRuns(nextRuns); setPollingError(''); }, setPollingError);
  }, [health]);
  // A bookmarked review may sit outside the API's recent-run window.
  useEffect(() => {
    if (!selectedId || selected || loading) return;
    const controller = new AbortController();
    api.getRun(selectedId, controller.signal).then(run => {
      if (!controller.signal.aborted) applyRuns([run]);
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); });
    return () => controller.abort();
  }, [selectedId, !!selected, loading]);

  const commits = runs.filter(run => isFixture || run.source.kind === 'git').filter((run, index, list) => {
    const key = (item: AnalysisRun) => item.source.kind === 'git' ? `${item.source.name}:${item.source.headSha}` : item.id;
    return list.findIndex(item => key(item) === key(run)) === index;
  });
  const outcome = selected && verdict(selected);
  return <div className="app-shell"><main className="main product-main">
    <header className="page-head analysis-header">
      <div className="page-title">
        <a className="back-link" href="#/">{selectedId ? '← Commits' : 'canonical'}</a>
        <h1>{selectedId ? selected?.source.kind === 'git' ? selected.source.headSha.slice(0, 7) : selected?.source.candidate ?? 'Commit review' : 'Commits'}</h1>
        {selected && <p className="breadcrumb">{selected.source.name}{selected.source.kind === 'git' && <> · {selected.source.baseSha.slice(0, 7)} → {selected.source.headSha.slice(0, 7)}</>}</p>}
      </div>
      {outcome && <StatusPill tone={outcome.tone}>{outcome.label}</StatusPill>}
    </header>
    {isFixture && <p className="banner banner-modified">Demo data · no code execution</p>}
    {(error || pollingError) && <div className="banner banner-failed" role="alert"><span>{error || pollingError}</span><button className="button button-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {loading && !runs.length ? <div className="panel empty-state" role="status">Loading commits…</div>
    : !selectedId ? <section className="commit-home" aria-label="Commits">
      {commits.length ? <ul className="commit-list">{commits.map(run => {
        const status = verdict(run);
        return <li key={run.id}><a className="commit-link" href={`#/commits/${encodeURIComponent(run.id)}`}>
          <div className="commit-copy"><strong className="mono">{run.source.kind === 'git' ? run.source.headSha.slice(0, 7) : run.source.candidate}</strong><span className="commit-meta">{run.source.name} · <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span></div>
          <span className="commit-result"><StatusPill tone={status.tone}>{status.label}</StatusPill><span aria-hidden="true">→</span></span>
        </a></li>;
      })}</ul> : <div className="panel empty-state"><h2>Your next commit starts here.</h2><p>Push a commit to the connected repository. Its review will appear automatically.</p></div>}
    </section> : selected ? <>
      {!!selected.review?.agents.length && <ul className="agent-strip" aria-label="Analysis progress">{selected.review.agents.map(item => <li key={item.id}><i className={`dot dot-${item.status === 'running' ? 'canonical pulse' : tone(item.status)}`} aria-hidden="true" /><span>{item.id === 'objects' ? 'Objects' : item.id === 'logic' ? 'Logic' : 'Business checks'}</span><small>{item.status}</small></li>)}</ul>}
      {selected.error && <p className="banner banner-failed" role="alert">{selected.error}</p>}
      <AnalysisWorkspace key={selected.id} run={selected} />
    </> : <div className="panel empty-state" role="status">{error ? 'This review is unavailable.' : 'Loading review…'}</div>}
  </main></div>;
}

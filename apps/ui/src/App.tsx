import { useEffect, useRef, useState } from 'react';
import type { AnalysisRun, ExecutionMode, Health, ReviewAgent } from '@canonical/contracts';
import { api, isFixture } from './lib/api';
import { mergeRunSnapshots, newlyDiscoveredRun } from './lib/run-state';
import { ObjectsSection } from './components/ObjectsSection';
import { LogicSection } from './components/LogicSection';
import { Reveal } from './components/ui';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const active = (run?: AnalysisRun) => run?.status === 'running' || run?.status === 'queued';
const sections = [
  { id: 'objects', label: 'Objects', icon: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 0v18M4 7.5l8 4.5 8-4.5' },
  { id: 'logic', label: 'Logic graph', icon: 'M12 3v4m0 0-5 5m5-5 5 5M7 12v3m10-3v3M5 15h4v4H5zm10 0h4v4h-4z' },
] as const;
const Icon = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function Pending({ agent, what }: { agent?: ReviewAgent; what: string }) {
  return <div className="panel empty-state compact" role="status">
    <span className="kicker"><i className={`dot ${agent?.status === 'error' ? 'dot-failed' : 'dot-canonical pulse'}`} aria-hidden="true" /> {agent?.status === 'error' ? 'Unavailable' : 'In progress'}</span>
    <p>{agent?.message ?? `This run has no extracted ${what}. Push a commit through the live review workflow to see it here.`}</p>
  </div>;
}

export function App() {
  const [health, setHealth] = useState<Health>();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const runsRef = useRef<AnalysisRun[]>([]);
  const seenRunIds = useRef(new Set<string>());
  const [selectedId, setSelectedId] = useState('');
  const [execution, setExecution] = useState<ExecutionMode>('local');
  const [error, setError] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState<string>('objects');
  const selected = runs.find(run => run.id === selectedId);
  const projectName = selected?.source.kind === 'git' ? selected.source.name : 'Quote shop';
  function applyRuns(incoming: AnalysisRun[]) {
    const merged = mergeRunSnapshots(runsRef.current, incoming);
    runsRef.current = merged;
    setRuns(merged);
    return merged;
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([api.health(controller.signal), api.listRuns(controller.signal)]).then(([nextHealth, nextRuns]) => {
      if (controller.signal.aborted) return;
      setHealth(nextHealth);
      const merged = applyRuns(nextRuns);
      newlyDiscoveredRun(merged, seenRunIds.current);
      setSelectedId(current => merged.some(run => run.id === current) ? current : merged[0]?.id ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  // SurrealDB-backed snapshots discover CI-created runs, including runs this
  // browser did not start. EventSource reconnects and the server resynchronizes.
  useEffect(() => {
    if (!health || isFixture) return;
    return api.subscribeRuns(nextRuns => {
      const merged = applyRuns(nextRuns);
      const arrival = newlyDiscoveredRun(merged, seenRunIds.current);
      setPollingError('');
      setSelectedId(current => arrival?.id ?? (merged.some(run => run.id === current) ? current : merged[0]?.id ?? ''));
    }, setPollingError);
    // The subscription owns current snapshots; only restart when the API changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  // Scroll spy: the rail follows whichever section is in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) setSection(entry.target.id); }), { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(item => { const element = document.getElementById(item.id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [selected?.id]);

  async function start() {
    setStarting(true); setError('');
    try { const run = await api.startRun(execution); applyRuns([run]); seenRunIds.current.add(run.id); setSelectedId(run.id); }
    catch (error) { setError(message(error)); }
    finally { setStarting(false); }
  }

  const daytona = health?.executionModes.includes('daytona') ?? false;
  const agent = (id: ReviewAgent['id']) => selected?.review?.agents.find(item => item.id === id);
  const runLabel = starting ? 'Starting…' : isFixture ? 'New fixture' : runs.some(active) ? 'Evaluation running…' : 'Run evaluation';

  return <div className="app-shell">
    <nav className="rail" aria-label="Sections">
      <a className="rail-logo" href="#top" aria-label="Canonical"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z" fill="#6A62E4" /><path d="m3 12 9 5 9-5" fill="none" stroke="#8479F3" strokeWidth="1.8" strokeLinejoin="round" opacity=".7" /><path d="m3 16 9 5 9-5" fill="none" stroke="#8479F3" strokeWidth="1.8" strokeLinejoin="round" opacity=".4" /></svg></a>
      {sections.map(item => <a key={item.id} href={`#${item.id}`} className={`rail-button ${section === item.id ? 'is-active' : ''}`} aria-label={item.label} aria-current={section === item.id ? 'true' : undefined}><Icon d={item.icon} /></a>)}
    </nav>

    <main className="main" id="top">
      <header className="page-head">
        <div className="page-title">
          <p className="breadcrumb">Workspace <span aria-hidden="true">/</span> {projectName}</p>
          <h1>{selected ? selected.source.candidate : 'Canonical'}</h1>
        </div>
        <div className="page-actions">
          <div className="segmented" role="radiogroup" aria-label="Execution environment">
            <button role="radio" aria-checked={execution === 'local'} onClick={() => setExecution('local')} disabled={starting || isFixture}>{isFixture ? 'UI fixture' : 'Local'}</button>
            <button role="radio" aria-checked={execution === 'daytona'} onClick={() => setExecution('daytona')} disabled={starting || isFixture || !daytona} title={daytona ? undefined : 'Daytona is not configured on this API'}>Daytona</button>
          </div>
          <button className="button button-primary" onClick={start} disabled={starting || loading || !health || (!isFixture && runs.some(active))}>{runLabel}</button>
        </div>
      </header>

      {isFixture && <p className="banner banner-modified"><i className="dot dot-modified" aria-hidden="true" />UI development fixture · Synthetic results · No code execution or backend connection</p>}
      {(error || pollingError) && <div className="banner banner-failed" role="alert"><i className="dot dot-failed" aria-hidden="true" /><span><strong>Unable to complete request.</strong> {error || pollingError}</span><button className="button button-sm" onClick={() => setRetry(value => value + 1)}>Retry connection</button></div>}

      {loading && !selected ? <div className="panel empty-state" role="status"><span className="kicker">Connecting</span><h2>Loading your workspace…</h2><div className="skeleton" /><div className="skeleton short" /></div>
      : selected ? <>
        <Reveal as="section" id="objects" className="section">
          <div className="section-head"><span className="kicker">01</span><h2>Objects</h2><p>What your agent is trying to change, as objects and their relationships.</p></div>
          {selected.review?.objects ? <ObjectsSection key={selected.id} run={selected} layer={selected.review.objects} /> : <Pending agent={agent('objects')} what="object layer" />}
        </Reveal>
        <Reveal as="section" id="logic" className="section">
          <div className="section-head"><span className="kicker">02</span><h2>Logic graph</h2><p>Every logic flow in the change. Pick one to see its flowchart.</p></div>
          {selected.review?.logic ? <LogicSection key={selected.id} run={selected} layer={selected.review.logic} /> : <Pending agent={agent('logic')} what="logic layer" />}
        </Reveal>
      </>
      : <div className="panel empty-state fading-grid"><span className="kicker">Business intent, verified</span><h2>See what your agent changed.</h2><p>Run an evaluation to map the change onto objects and logic flows, with an efficiency evaluation and suggestions you can confirm or deny.</p><button className="button button-primary" onClick={start} disabled={starting || !health}>Run your first evaluation</button></div>}
    </main>
  </div>;
}

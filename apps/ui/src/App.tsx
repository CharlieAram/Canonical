import { useEffect, useRef, useState } from 'react';
import type { AnalysisRun, ContextWorkspace, ExecutionMode, Health } from '@canonical/contracts';
import { api, isFixture } from './lib/api';
import { mergeRunSnapshots, newlyDiscoveredRun } from './lib/run-state';
import { requirementStatuses, timeAgo, verdict } from './lib/verdict';
import { BusinessGraph } from './components/BusinessGraph';
import { EvidencePanel } from './components/EvidencePanel';
import { RequirementsPanel } from './components/RequirementsPanel';
import { RevisionPanel } from './components/RevisionPanel';
import { RunSummary } from './components/RunSummary';
import { ReviewPipeline, LayerDiffView, BillOfBusiness } from './components/ReviewPipeline';
import { BusinessContextPanel } from './components/BusinessContextPanel';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const active = (run?: AnalysisRun) => run?.status === 'running' || run?.status === 'queued';
type Tab = 'objects' | 'flow' | 'requirements' | 'context' | 'diff';
const tabs: { id: Tab; label: string }[] = [{ id: 'objects', label: 'Object layer' }, { id: 'flow', label: 'Logic flow' }, { id: 'requirements', label: 'Bill of business' }, { id: 'context', label: 'Business context' }, { id: 'diff', label: 'Code diff' }];
const Icon = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const icons = {
  review: 'M3 12h5m8 0h5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  history: 'M4 6h16M4 12h16M4 18h10',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
};

export function App() {
  const [health, setHealth] = useState<Health>();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const runsRef = useRef<AnalysisRun[]>([]);
  const seenRunIds = useRef(new Set<string>());
  const [selectedId, setSelectedId] = useState('');
  const [conceptId, setConceptId] = useState('quote');
  const [execution, setExecution] = useState<ExecutionMode>('local');
  const [error, setError] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [businessContext, setBusinessContext] = useState<ContextWorkspace>();
  const reportInput = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<Tab>('flow');
  const [historyOpen, setHistoryOpen] = useState(false);
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
      if (arrival) setConceptId(arrival.graph.nodes.some(node => node.id === 'quote') ? 'quote' : arrival.graph.nodes[0]?.id ?? '');
    }, setPollingError);
    // The subscription owns current snapshots; only restart when the API changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  async function start() {
    setStarting(true); setError(''); setImportNotice('');
    try { const run = await api.startRun(execution); applyRuns([run]); seenRunIds.current.add(run.id); setSelectedId(run.id); setConceptId('quote'); }
    catch (error) { setError(message(error)); }
    finally { setStarting(false); }
  }
  async function importReport(file?: File) {
    if (!file) return;
    setImporting(true); setError(''); setImportNotice('');
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a report smaller than 1 MiB.');
      let report: unknown;
      try { report = JSON.parse(await file.text()); }
      catch { throw new Error('This file is not valid JSON. Choose the report.json produced by Canonical.'); }
      const run = await api.importRun(report);
      applyRuns([run]); seenRunIds.current.add(run.id);
      setSelectedId(run.id);
      setConceptId(run.graph.nodes.some(node => node.id === 'quote') ? 'quote' : run.graph.nodes[0]?.id ?? '');
      setImportNotice(`Imported ${file.name}. Showing its recorded results; importing does not execute code.`);
      try {
        const nextRuns = await api.listRuns();
        const merged = applyRuns(nextRuns);
        newlyDiscoveredRun(merged, seenRunIds.current);
      } catch { setImportNotice(`Imported ${file.name}. Run history could not refresh; the imported report is available below.`); }
    } catch (error) { setError(message(error)); }
    finally {
      setImporting(false);
      if (reportInput.current) reportInput.current.value = '';
    }
  }
  async function download() {
    if (!selected) return;
    setDownloading(true); setError('');
    try {
      const markdown = await api.context(selected.id);
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `canonical-${selected.id}.md`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(message(error)); }
    finally { setDownloading(false); }
  }

  const status = selected && verdict(selected);
  const git = selected?.source.kind === 'git' ? selected.source : undefined;
  const daytona = health?.executionModes.includes('daytona') ?? false;
  const runLabel = starting ? 'Starting…' : isFixture ? 'New fixture' : runs.some(active) ? 'Evaluation running…' : selected?.source.kind === 'git' ? 'Run pricing fixture' : 'Run evaluation';
  const selectRun = (run: AnalysisRun) => { setSelectedId(run.id); setConceptId(run.graph.nodes.some(node => node.id === 'quote') ? 'quote' : run.graph.nodes[0]?.id ?? ''); setHistoryOpen(false); };
  const onTabKey = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : undefined;
    if (next === undefined) return;
    const item = tabs[(next + tabs.length) % tabs.length]!;
    setTab(item.id);
    document.getElementById(`tab-${item.id}`)?.focus();
  };

  return <div className="app-shell">
    <nav className="rail" aria-label="Primary">
      <a className="rail-logo" href="/" aria-label="Canonical home"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z" fill="#6A62E4" /><path d="m3 12 9 5 9-5" fill="none" stroke="#8479F3" strokeWidth="1.8" strokeLinejoin="round" opacity=".7" /><path d="m3 16 9 5 9-5" fill="none" stroke="#8479F3" strokeWidth="1.8" strokeLinejoin="round" opacity=".4" /></svg></a>
      <button className="rail-button is-active" aria-label="Review" aria-current="page"><Icon d={icons.review} /></button>
      <button className={`rail-button ${historyOpen ? 'is-active' : ''}`} aria-label="Run history" aria-expanded={historyOpen} aria-controls="history-drawer" onClick={() => setHistoryOpen(value => !value)}><Icon d={icons.history} /></button>
      <button className="rail-button" aria-label="Download agent context" onClick={download} disabled={!selected || downloading || selected.status !== 'completed'}><Icon d={icons.download} /></button>
      <span className="rail-status" title={isFixture ? 'Synthetic UI fixture' : health ? `Connected · ${health.storage === 'surreal' ? 'SurrealDB' : 'in-memory'} storage` : 'Not connected'}><i className={`dot ${health ? 'dot-added' : 'dot-failed'}`} aria-hidden="true" /><span className="sr-only">{health ? 'API connected' : 'API not connected'}</span></span>
    </nav>

    {historyOpen && <div className="drawer-scrim" onClick={() => setHistoryOpen(false)} aria-hidden="true" />}
    <aside id="history-drawer" className={`drawer panel ${historyOpen ? 'is-open' : ''}`} aria-label="Run history" hidden={!historyOpen} onKeyDown={event => { if (event.key === 'Escape') setHistoryOpen(false); }}>
      <div className="panel-head"><div><h2>Run history</h2><p>{projectName}</p></div><button className="button button-sm" onClick={() => setRetry(value => value + 1)} disabled={loading || starting}><Icon d={icons.refresh} /> Refresh</button></div>
      <ul className="stack history-list">{runs.map((run, index) => { const runVerdict = verdict(run); return <li key={run.id}><button className={`history-item ${run.id === selectedId ? 'is-selected' : ''}`} aria-current={run.id === selectedId} onClick={() => selectRun(run)}>
        <i className={`dot dot-${runVerdict.tone === 'neutral' ? 'canonical' : runVerdict.tone}`} aria-hidden="true" />
        <span><strong>{isFixture ? 'UI fixture' : run.source.kind === 'git' ? 'Git comparison' : 'Pricing evaluation'} {runs.length - index}</strong><small>{new Date(run.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {run.execution} · {runVerdict.label}</small></span>
      </button></li>; })}</ul>
      {!isFixture && <><input ref={reportInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose Canonical report JSON" onChange={event => void importReport(event.target.files?.[0])} /><button className="button" onClick={() => reportInput.current?.click()} disabled={importing || loading || !health}>{importing ? 'Importing…' : 'Import report JSON'}</button></>}
      <dl className="well facts connections">
        <div><dt>Execution</dt><dd>{isFixture ? 'Synthetic UI fixture' : daytona ? 'Local and Daytona' : 'Local process'}</dd></div>
        <div><dt>Storage</dt><dd>{health?.storage === 'surreal' ? 'SurrealDB' : 'In-memory'}</dd></div>
        <p>{health?.storage === 'memory' && !isFixture ? 'Runs reset when the API restarts.' : isFixture ? 'No backend requests or execution.' : 'Business evidence, connected.'}</p>
      </dl>
    </aside>

    <main className="main">
      <header className="page-head">
        <div className="page-title">
          <p className="breadcrumb">Workspace <span aria-hidden="true">/</span> {projectName} {selected && <><span aria-hidden="true">/</span> {git ? 'Git comparison' : 'Pricing evaluation'}</>}</p>
          <h1>{selected ? selected.source.candidate : 'Canonical'}</h1>
          {selected && <ul className="meta" aria-label="Run details">
            <li className="pill"><i className="dot dot-canonical" aria-hidden="true" />{selected.execution === 'daytona' ? 'Daytona sandbox' : isFixture ? 'UI fixture' : 'Local process'}</li>
            <li className="mono">{git ? `${git.baseSha.slice(0, 7)} → ${git.headSha.slice(0, 7)}` : `${selected.source.baseline} → ${selected.source.candidate}`}</li>
            {git && <li>{git.changedFiles.length} changed {git.changedFiles.length === 1 ? 'file' : 'files'}</li>}
            <li>{timeAgo(selected.createdAt)}</li>
          </ul>}
        </div>
        <div className="page-actions">
          {status && <span className={`pill pill-lg pill-${status.tone}`} role="status"><i className={`dot dot-${status.tone === 'neutral' ? 'canonical pulse' : status.tone}`} aria-hidden="true" />{status.label}{status.detail && ` · ${status.detail}`}</span>}
          <div className="segmented" role="radiogroup" aria-label="Execution environment">
            <button role="radio" aria-checked={execution === 'local'} onClick={() => setExecution('local')} disabled={starting || isFixture}>{isFixture ? 'UI fixture' : 'Local'}</button>
            <button role="radio" aria-checked={execution === 'daytona'} onClick={() => setExecution('daytona')} disabled={starting || isFixture || !daytona} title={daytona ? undefined : 'Daytona is not configured on this API'}>Daytona</button>
          </div>
          <button className="button button-primary" onClick={start} disabled={starting || loading || importing || !health || (!isFixture && runs.some(active))}>{runLabel}</button>
        </div>
      </header>

      {isFixture && <p className="banner banner-modified"><i className="dot dot-modified" aria-hidden="true" />UI development fixture · Synthetic results · No code execution or backend connection</p>}
      {importNotice && <p className="banner banner-added" role="status"><i className="dot dot-added" aria-hidden="true" />{importNotice}</p>}
      {(error || pollingError) && <div className="banner banner-failed" role="alert"><i className="dot dot-failed" aria-hidden="true" /><span><strong>Unable to complete request.</strong> {error || pollingError}</span><button className="button button-sm" onClick={() => setRetry(value => value + 1)}>Retry connection</button></div>}

      {loading && !selected ? <div className="panel empty-state" role="status"><span className="kicker">Connecting</span><h2>Loading your workspace…</h2><div className="skeleton" /><div className="skeleton short" /></div>
      : selected ? <>
        <RunSummary run={selected} />
        <ReviewPipeline run={selected} />
        <div className="segmented tabs" role="tablist" aria-label="Review views" onKeyDown={onTabKey}>{tabs.map(item => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="tab-panel">
          {tab === 'objects' && (selected.review?.objects ? <LayerDiffView layer={selected.review.objects} title="Object layer diff" /> : <section className="panel"><p>{selected.review ? 'Object extraction is pending or unavailable; inspect task status above.' : 'This older report has no extracted object layer. Push a commit using the live review workflow.'}</p></section>)}
          {tab === 'flow' && <>{selected.review?.logic && <LayerDiffView layer={selected.review.logic} title="Logic flow diff" />}<BusinessGraph graph={selected.graph} selectedId={conceptId} onSelect={setConceptId} requirements={requirementStatuses(selected)} /><div className="analysis-layout"><EvidencePanel run={selected} conceptId={conceptId} approvals={businessContext?.runId === selected.id ? businessContext.approvals : []} /><RequirementsPanel run={selected} /></div></>}
          {tab === 'requirements' && <><BillOfBusiness run={selected} /><RequirementsPanel run={selected} wide /></>}
          {tab === 'diff' && <RevisionPanel run={selected} />}
          {/* Kept mounted so reviewed approvals reach the evidence panel from any tab. */}
          <div hidden={tab !== 'context'}><BusinessContextPanel key={selected.id} run={selected} onChange={setBusinessContext} /></div>
        </div>
        <section className="panel context-card"><div><h2>Close the loop with your coding agent</h2><p>Export approved requirements and observed evidence as Markdown for the next agent session.</p></div><button className="button button-primary" onClick={download} disabled={downloading || selected.status !== 'completed'}>{downloading ? 'Preparing…' : 'Download agent context'} <span aria-hidden="true">↓</span></button></section>
      </>
      : <div className="panel empty-state fading-grid"><span className="kicker">Business intent, verified</span><h2>A faster quote.<br />A hidden pricing regression.</h2><p>Run both versions of the pricing fixture to connect measured performance with executable business requirements.</p><button className="button button-primary" onClick={start} disabled={starting || !health}>Run your first evaluation</button><small>Explicit demo scenario. The graph and requirements are declared; execution produces the evidence.</small></div>}
    </main>
  </div>;
}

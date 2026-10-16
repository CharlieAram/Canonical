import { useEffect, useRef, useState } from 'react';
import type { AnalysisRun, ContextWorkspace, ExecutionMode, Health } from '@canonical/contracts';
import { api, isFixture } from './lib/api';
import { BusinessGraph } from './components/BusinessGraph';
import { EvidencePanel } from './components/EvidencePanel';
import { RunSummary } from './components/RunSummary';
import { BusinessContextPanel } from './components/BusinessContextPanel';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const active = (run?: AnalysisRun) => run?.status === 'running' || run?.status === 'queued';

export function App() {
  const [health, setHealth] = useState<Health>();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
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
  const selected = runs.find(run => run.id === selectedId);
  const projectName = selected?.source.kind === 'git' ? selected.source.name : 'Quote shop';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([api.health(controller.signal), api.listRuns(controller.signal)]).then(([nextHealth, nextRuns]) => {
      if (controller.signal.aborted) return;
      setHealth(nextHealth);
      setRuns(nextRuns);
      setSelectedId(current => nextRuns.some(run => run.id === current) ? current : nextRuns[0]?.id ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  // Keep tracking execution even while an older report is selected.
  const pendingRunId = runs.find(active)?.id;
  useEffect(() => {
    setPollingError('');
    if (!pendingRunId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const run = await api.getRun(pendingRunId!, controller.signal);
        if (controller.signal.aborted) return;
        setPollingError('');
        setRuns(current => current.map(item => item.id === run.id ? run : item));
        if (active(run)) timer = setTimeout(poll, 1000);
      } catch (error) {
        if (!controller.signal.aborted) { setPollingError(message(error)); timer = setTimeout(poll, 3000); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pendingRunId]);

  async function start() {
    setStarting(true); setError(''); setImportNotice('');
    try { const run = await api.startRun(execution); setRuns(current => [run, ...current.filter(item => item.id !== run.id)]); setSelectedId(run.id); setConceptId('quote'); }
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
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      setSelectedId(run.id);
      setConceptId(run.graph.nodes.some(node => node.id === 'quote') ? 'quote' : run.graph.nodes[0]?.id ?? '');
      setImportNotice(`Imported ${file.name}. Showing its recorded results; importing does not execute code.`);
      try {
        const nextRuns = await api.listRuns();
        setRuns([run, ...nextRuns.filter(item => item.id !== run.id)]);
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

  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="/"><span className="brand-mark">C</span> canonical<span className="version">v0</span></a><p className="brand-description">Keep business intent<br />in the loop.</p>
    <div className="project-label">Workspace</div><div className="project"><span className="project-icon">{selected?.source.kind === 'git' ? 'G' : 'Q'}</span><div><strong>{projectName}</strong><small>{selected?.source.kind === 'git' ? 'Git revision comparison' : 'Pricing cache scenario'}</small></div></div>
    <div className="project-label history-title">Run history <button className="text-button" onClick={() => setRetry(value => value + 1)} disabled={loading || starting}>Refresh</button></div>
    <nav aria-label="Run history" className="run-history">{runs.map((run, index) => <button key={run.id} className={`history-item ${run.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(run.id); setConceptId(run.graph.nodes.some(node => node.id === 'quote') ? 'quote' : run.graph.nodes[0]?.id ?? ''); }}><span className={`dot ${run.status === 'error' ? 'red' : run.status === 'completed' ? 'green' : 'purple'}`} /><span><strong>{isFixture ? 'UI fixture' : run.source.kind === 'git' ? 'Git comparison' : 'Pricing evaluation'} {runs.length - index}</strong><small>{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {run.execution} · {run.status}</small></span></button>)}</nav>
    <div className="sidebar-bottom"><span className="eyebrow">Connections</span><p>Execution <strong>{isFixture ? 'Synthetic UI fixture' : health?.executionModes.includes('daytona') ? 'Local + Daytona' : 'Local process'}</strong></p><p>Storage <strong>{health?.storage === 'surreal' ? 'SurrealDB' : 'In-memory'}</strong></p><small>{health?.storage === 'memory' && !isFixture ? 'Runs reset when the API restarts.' : isFixture ? 'No backend requests or execution.' : 'Business evidence, connected.'}</small></div>
  </aside><main><header className="topbar"><div className="workspace-name"><span className="breadcrumb">Workspace /</span> {projectName}</div><div className="actions">{!isFixture && <><input ref={reportInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose Canonical report JSON" onChange={event => void importReport(event.target.files?.[0])} /><button className="secondary-button" onClick={() => reportInput.current?.click()} disabled={importing || loading || !health}>{importing ? 'Importing…' : 'Import report JSON'}</button></>}<label className="sr-only" htmlFor="execution-mode">Execution environment</label><select id="execution-mode" value={execution} onChange={event => setExecution(event.target.value as ExecutionMode)} disabled={starting || isFixture}><option value="local">{isFixture ? 'UI fixture' : 'Local execution'}</option>{health?.executionModes.includes('daytona') && <option value="daytona">Daytona sandbox</option>}</select><button className="primary-button" onClick={start} disabled={starting || loading || importing || !health || (!isFixture && runs.some(active))}>{starting ? 'Starting…' : isFixture ? 'New fixture' : runs.some(active) ? 'Evaluation running…' : selected?.source.kind === 'git' ? 'Run pricing fixture' : 'Run evaluation'}<span aria-hidden="true">↗</span></button></div></header>
    <div className="workspace">{isFixture && <p className="fixture-banner">UI development fixture · Synthetic results · No code execution or backend connection</p>}{importNotice && <p className="import-notice" role="status">{importNotice}</p>}{(error || pollingError) && <div className="error-banner" role="alert"><strong>Unable to complete request.</strong> {error || pollingError} <button onClick={() => setRetry(value => value + 1)}>Retry connection</button></div>}
    {loading && !selected ? <div className="empty-state" role="status"><span className="eyebrow">Connecting</span><h1>Loading your workspace…</h1></div> : selected ? <><RunSummary run={selected} /><BusinessContextPanel key={selected.id} run={selected} onChange={setBusinessContext} /><div className="analysis-layout"><BusinessGraph graph={selected.graph} selectedId={conceptId} onSelect={setConceptId} /><EvidencePanel run={selected} conceptId={conceptId} approvals={businessContext?.runId === selected.id ? businessContext.approvals : []} /></div><footer className="context-footer"><div><h3>Close the loop with your coding agent</h3><p>Export approved requirements and observed evidence as Markdown.</p></div><button className="secondary-button" onClick={download} disabled={downloading || selected.status !== 'completed'}>{downloading ? 'Preparing…' : 'Download agent context'} <span aria-hidden="true">↓</span></button></footer></> : <div className="empty-state"><span className="eyebrow">Business intent, verified</span><h1>A faster quote.<br />A hidden pricing regression.</h1><p>Run both versions of the pricing fixture to connect measured performance with executable business requirements.</p><button className="primary-button" onClick={start} disabled={starting || !health}>Run your first evaluation ↗</button><small>Explicit demo scenario. Graph and requirements are declared; execution produces the evidence.</small></div>}
    </div></main></div>;
}

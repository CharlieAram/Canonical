import type { AnalysisRun, Evaluation } from '@canonical/contracts';
import { milliseconds, requirementStatuses, variants } from '../lib/verdict';

function Sparkline({ samples, tone }: { samples: number[]; tone: 'added' | 'failed' | 'neutral' }) {
  if (samples.length < 2) return null;
  const max = Math.max(...samples), min = Math.min(...samples), span = max - min || 1;
  const points = samples.map((value, index) => `${(index / (samples.length - 1)) * 60},${16 - ((value - min) / span) * 14}`).join(' ');
  return <svg className={`sparkline spark-${tone}`} width="60" height="18" viewBox="0 0 60 18" aria-hidden="true"><polyline points={points} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Metric({ label, result, delta }: { label: string; result?: Evaluation; delta?: number }) {
  const tone = delta === undefined ? 'neutral' : delta < 0 ? 'added' : 'failed';
  return <div className="well metric-row">
    <div><span>{label}{result ? `, ${result.benchmark.samples.length} samples` : ''}</span><strong>{result ? `${milliseconds(result.benchmark.median)} ms` : '-'}</strong></div>
    {result && <div className="metric-trend"><Sparkline samples={result.benchmark.samples} tone={tone} />{delta !== undefined && <span className={`text-${tone}`}>{delta > 0 ? '+' : ''}{Math.round(delta * 100)}%</span>}</div>}
  </div>;
}

export function RequirementsPanel({ run, wide = false }: { run: AnalysisRun; wide?: boolean }) {
  const statuses = requirementStatuses(run);
  const { baseline, candidate } = variants(run);
  const count = (status: string) => statuses.filter(item => item.status === status).length;
  // Percentage change is only shown when the candidate median is above display precision.
  const delta = baseline && candidate && candidate.benchmark.median >= 0.01 && baseline.benchmark.median > 0 ? (candidate.benchmark.median - baseline.benchmark.median) / baseline.benchmark.median : undefined;
  return <div className={wide ? 'requirements-wide' : 'requirements-column'}>
    <section className="panel" aria-label="Hard requirements">
      <div className="panel-head"><h2>Hard requirements</h2><span className="count">{count('met')} met · {count('failed')} failed · {count('unverified')} not verified</span></div>
      <ul className="stack requirement-list">{statuses.map(item => <li key={item.requirement.id} className={item.status === 'failed' ? 'requirement raised' : 'well requirement'}>
        <i className={`dot dot-${item.status === 'met' ? 'added' : item.status === 'failed' ? 'failed' : 'modified'}`} aria-hidden="true" />
        <div><strong>{item.requirement.text}</strong><span className={`text-${item.status === 'failed' ? 'failed' : 'muted'}`}>{item.note}</span></div>
      </li>)}</ul>
    </section>
    <section className="panel" aria-label="Performance">
      <div className="panel-head"><div><h2>Performance</h2><p>{candidate ? candidate.benchmark.label : 'Runtime performance not measured yet'}</p></div></div>
      {baseline || candidate ? <div className="stack">
        <Metric label="Baseline median" result={baseline} />
        <Metric label="Candidate median" result={candidate} delta={delta} />
        {baseline && candidate && <div className="well metric-row"><div><span>Upstream calls</span><strong>{baseline.benchmark.upstreamCalls} → {candidate.benchmark.upstreamCalls}</strong></div></div>}
        <p className="footnote">Warm repeat-quote workload with {(candidate ?? baseline)!.benchmark.simulatedUpstreamMs} ms simulated upstream latency. These measurements describe this demo, not production performance.</p>
      </div> : <p className="muted">Timings appear once both versions have run. Nothing is estimated.</p>}
    </section>
  </div>;
}

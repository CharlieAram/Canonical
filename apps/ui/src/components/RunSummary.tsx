import type { AnalysisRun } from '@canonical/contracts';
import { milliseconds, plural, speedup, variants } from '../lib/verdict';

export function RunSummary({ run }: { run: AnalysisRun }) {
  const { baseline, candidate } = variants(run);
  const failed = candidate?.checks.filter(check => check.status === 'failed').length;
  const total = candidate?.checks.length ?? 0;
  const changed = run.graph.nodes.filter(node => node.change !== 'unchanged').length;
  const added = run.graph.nodes.filter(node => node.change === 'added').length;
  const ratio = speedup(run);
  const summary = [
    `The candidate, ${run.source.candidate}, changes ${plural(changed, 'business concept')} and adds ${added} compared with ${run.source.baseline}.`,
    candidate ? (failed ? `${failed} of ${plural(total, 'requirement check')} failed on the candidate, so it should not merge as it is.` : `All ${plural(total, 'requirement check')} passed on the candidate.`) : run.status === 'error' ? 'The evaluation stopped before candidate evidence was recorded.' : 'Requirement checks run once both versions execute.',
    baseline && candidate ? `Median ${baseline.benchmark.label.toLowerCase()} went from ${milliseconds(baseline.benchmark.median)} ms to ${milliseconds(candidate.benchmark.median)} ms.` : '',
  ].filter(Boolean).join(' ');
  return <>
    <section className="panel summary-card" aria-label="Summary">
      <p className="summary-copy">{summary}</p>
      <div className="stat-wells">
        <div className="well stat"><strong>{changed}</strong><span>concepts changed</span></div>
        <div className="well stat"><strong className="text-added">{added}</strong><span>new concepts</span></div>
        <div className="well stat"><strong className={failed ? 'text-failed' : ''}>{failed ?? '-'}</strong><span>requirements failed</span></div>
        <div className="well stat"><strong>{ratio ? `${ratio.toFixed(1)}×` : candidate ? `${milliseconds(candidate.benchmark.median)}` : '-'}</strong><span>{ratio ? 'speed vs baseline' : candidate ? 'candidate median, ms' : 'awaiting timing'}</span></div>
      </div>
    </section>
    <div className="run-stage" role="status"><i className={`dot ${run.status === 'error' ? 'dot-failed' : run.status === 'completed' ? 'dot-added' : 'dot-canonical pulse'}`} aria-hidden="true" />{run.stage}</div>
    {run.error && <p className="banner banner-failed" role="alert"><i className="dot dot-failed" aria-hidden="true" />{run.error}</p>}
    {run.results.flatMap(result => result.warnings.map((warning, index) => <p className="banner banner-modified" key={`${result.variant}-${index}`}><i className="dot dot-modified" aria-hidden="true" />{result.variant}: {warning}</p>))}
  </>;
}

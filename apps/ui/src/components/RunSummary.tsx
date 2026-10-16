import type { AnalysisRun } from '@canonical/contracts';

const milliseconds = (value: number) => value < 0.01 ? '<0.01' : value.toFixed(2);
export function RunSummary({ run }: { run: AnalysisRun }) {
  const baseline = run.results.find(result => result.variant === 'baseline');
  const candidate = run.results.find(result => result.variant === 'candidate');
  const failed = candidate?.checks.filter(check => check.status === 'failed').length;
  const git = run.source.kind === 'git' ? run.source : undefined;
  // Avoid amplifying sub-display-precision samples into an unstable speedup claim.
  const speedup = baseline && candidate && candidate.benchmark.median >= 0.01 ? baseline.benchmark.median / candidate.benchmark.median : undefined;
  return <>
    <div className="run-heading"><div><span className="eyebrow">{git ? 'Git revision comparison' : 'Pricing cache experiment'}</span><h1>{failed ? 'A business requirement failed.' : run.status === 'completed' ? 'Business checks passed.' : 'Does faster still mean correct?'}</h1><p>{run.source.baseline} <span aria-hidden="true">→</span> {run.source.candidate}</p></div><span className={`status status-${run.status === 'error' ? 'error' : run.status === 'completed' ? 'success' : 'neutral'}`}>{run.status}</span></div>
    {git && <details className="revision-details" open><summary>Revision evidence · {git.changedFiles.length} changed {git.changedFiles.length === 1 ? 'file' : 'files'}</summary><dl><div><dt>Repository</dt><dd>{git.name}</dd></div><div><dt>Baseline SHA</dt><dd><code>{git.baseSha}</code></dd></div><div><dt>Candidate SHA</dt><dd><code>{git.headSha}</code></dd></div><div><dt>Declared policy</dt><dd><code>{git.policyPath}</code></dd></div></dl><p>The business map and requirements come from the declared policy. Checks provide execution evidence.</p>{git.changedFiles.length ? <ul aria-label="Changed files">{git.changedFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p>No changed files between these revisions.</p>}</details>}
    <div className="metrics"><article className="metric"><span>Baseline median</span><strong>{baseline ? milliseconds(baseline.benchmark.median) : '—'} <small>ms</small></strong><p>{baseline ? `${baseline.benchmark.upstreamCalls} upstream calls` : 'Awaiting execution'}</p></article><article className="metric"><span>Candidate median</span><strong>{candidate ? milliseconds(candidate.benchmark.median) : '—'} <small>ms</small></strong><p>{speedup ? `${speedup.toFixed(1)}× faster on this workload` : candidate ? `${candidate.benchmark.upstreamCalls} upstream calls` : 'Awaiting execution'}</p></article><article className={`metric ${failed ? 'metric-danger' : ''}`}><span>Candidate requirements</span><strong>{failed === undefined ? '—' : failed} <small>failed</small></strong><p>{candidate ? `${candidate.checks.filter(check => check.status === 'passed').length} checks passed` : 'Correctness before confidence'}</p></article></div>
    <div className="run-stage" role="status"><span className={`dot ${run.status === 'error' ? 'red' : 'purple'}`} />{run.stage}</div>
    {run.error && <p className="error-banner" role="alert">{run.error}</p>}
    {run.results.length > 0 && <p className="benchmark-note">Warm repeat-quote workload with {run.results[0]!.benchmark.simulatedUpstreamMs} ms simulated upstream latency. These measurements describe this demo, not production performance.</p>}
    {run.results.flatMap(result => result.warnings.map((warning, index) => <p className="notice" key={`${result.variant}-${index}`}>{result.variant}: {warning}</p>))}
  </>;
}

import type { AnalysisRun } from '@canonical/contracts';

export function RevisionPanel({ run }: { run: AnalysisRun }) {
  const git = run.source.kind === 'git' ? run.source : undefined;
  return <div className="revision-layout">
    <section className="panel" aria-label="Revision evidence">
      <div className="panel-head"><div><h2>{git ? `${git.changedFiles.length} changed ${git.changedFiles.length === 1 ? 'file' : 'files'}` : 'Bundled fixture versions'}</h2><p>{git ? 'The business map and requirements come from the declared policy. Checks provide execution evidence.' : 'The pricing fixture compares two bundled implementations, not Git revisions.'}</p></div></div>
      <dl className="well facts">
        <div><dt>Repository</dt><dd>{run.source.name}</dd></div>
        <div><dt>Baseline</dt><dd>{run.source.baseline}{git && <code>{git.baseSha}</code>}</dd></div>
        <div><dt>Candidate</dt><dd>{run.source.candidate}{git && <code>{git.headSha}</code>}</dd></div>
        {git && <div><dt>Declared policy</dt><dd><code>{git.policyPath}</code></dd></div>}
      </dl>
      {git && (git.changedFiles.length ? <ul className="file-list" aria-label="Changed files">{git.changedFiles.map(file => <li key={file} className="chip mono"><i className="dot dot-modified" aria-hidden="true" />{file}</li>)}</ul> : <p className="muted">No changed files between these revisions.</p>)}
    </section>
    <section className="panel" aria-label="Execution environments">
      <div className="panel-head"><h2>Where it ran</h2></div>
      {run.results.length ? <ul className="stack">{run.results.map(result => <li key={result.variant}><dl className="well facts">
        <div><dt>{result.variant === 'baseline' ? 'Baseline' : 'Candidate'}</dt><dd>{result.runtime}</dd></div>
        {result.sandboxId && <div><dt>Sandbox</dt><dd><code>{result.sandboxId}</code></dd></div>}
        {result.commitSha && <div><dt>Commit</dt><dd><code>{result.commitSha}</code></dd></div>}
      </dl></li>)}</ul> : <p className="muted">No execution recorded yet.</p>}
    </section>
  </div>;
}

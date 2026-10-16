import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { MergedNode } from '../lib/review';
import { sourceDiff } from '../lib/source-diff';

export function ChangeDrawer({ change, onClose }: { change: MergedNode; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const files = useMemo(() => sourceDiff(change.before, change.after), [change.before, change.after]);
  const propertyNames = [...new Set([...Object.keys(change.before?.properties ?? {}), ...Object.keys(change.after?.properties ?? {})])];
  const changedProperties = propertyNames.filter(name => change.before?.properties[name] !== change.after?.properties[name]);

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    // Selecting another graph node while the drawer is open must not steal focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('.change-drawer')) returnFocus.current = active;
  }, [change.id]);

  return <section className="change-drawer" role="dialog" aria-modal="false" aria-label={`${change.node.label} source change`}>
    <header className="drawer-header">
      <div className="drawer-title"><h2>{change.node.label}</h2><p className="drawer-meta">Cited source diff · <span>{change.change}</span></p></div>
      <button ref={closeButton} className="button button-sm drawer-close" type="button" onClick={onClose} aria-label="Close source diff">Close ×</button>
    </header>
    <div className="drawer-body">
      <p className="diff-note">These are cited excerpts, not a full-file diff. Line numbers locate the excerpts; their first or last line may be partial.</p>
      {!files.length && <p className="diff-note">No source citations are available for this change.</p>}
      {files.map((file, fileIndex) => <section className="source-file" key={`${file.path}:${fileIndex}`} aria-label={`Source diff for ${file.path}`}>
        <header><h3>{file.path}</h3><p className="drawer-meta">
          {file.before ? `Baseline ${file.before.sha.slice(0, 8)} · lines ${file.before.startLine}–${file.before.endLine}` : 'No baseline citation'}
          {' → '}
          {file.after ? `Candidate ${file.after.sha.slice(0, 8)} · lines ${file.after.startLine}–${file.after.endLine}` : 'No candidate citation'}
        </p></header>
        {file.unpaired ? <p className="diff-note">Unpaired {file.before ? 'baseline' : 'candidate'} cited block. No matching source entity was established in the other revision; this is not evidence that these lines were removed or added.</p>
          : (!file.before || !file.after) && <p className="diff-note">Only one revision has a citation here; this does not establish that the file was added or removed.</p>}
        {file.otherCitations > 0 && <p className="diff-note">{file.otherCitations} contained citations are already covered by the larger coherent source blocks.</p>}
        {file.unchanged && <p className="diff-note">The cited source is unchanged.</p>}
        {file.truncated && <p className="diff-note">Preview limited to 300 lines and 40,000 characters per excerpt. Changes beyond this preview are not shown.</p>}
        <table className="diff-table" aria-label={`${file.path} unified cited source diff`}>
          <thead className="sr-only"><tr><th>Baseline line</th><th>Candidate line</th><th>Change</th><th>Source</th></tr></thead>
          <tbody>{file.hunks.map((hunk, hunkIndex) => <Fragment key={hunkIndex}>
            {hunk.omittedBefore > 0 && <tr className="diff-hunk"><td colSpan={4}>… {hunk.omittedBefore} unchanged lines omitted</td></tr>}
            <tr className="diff-hunk"><td colSpan={4}><code>@@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@</code></td></tr>
            {hunk.lines.map((line, lineIndex) => <Fragment key={lineIndex}>
              <tr className={`diff-row-${line.kind}`}>
                <td className="diff-line-number">{line.oldLine ?? ''}</td><td className="diff-line-number">{line.newLine ?? ''}</td>
                <td className="diff-sign" aria-label={line.kind === 'add' ? 'Added cited line' : line.kind === 'remove' ? 'Removed cited line' : 'Unchanged cited line'}>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</td>
                <td className="diff-code"><code>{line.text || ' '}</code></td>
              </tr>
              {line.noNewline && <tr className="diff-hunk"><td colSpan={4}>\ Cited excerpt ends without a newline; the source line may continue.</td></tr>}
            </Fragment>)}
          </Fragment>)}</tbody>
        </table>
        {file.omittedAfter > 0 && <p className="diff-note">… {file.omittedAfter} unchanged lines omitted</p>}
      </section>)}
      {changedProperties.length > 0 && <section className="source-file property-diff" aria-label="Extracted property changes"><h3>Extracted property changes</h3><p className="diff-note">Interpretations of the cited source, shown separately from source edits.</p>
        <table className="diff-table"><thead><tr><th>Property</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>{changedProperties.map(name => <tr key={name}><th>{name}</th><td>{change.before?.properties[name] ?? 'Not supplied'}</td><td>{change.after?.properties[name] ?? 'Not supplied'}</td></tr>)}</tbody></table>
      </section>}
    </div>
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import type { AnalysisRun, ContextImport, ContextWorkspace, ReviewProposal } from '@canonical/contracts';
import { api, isFixture } from '../lib/api';

const example = '[00:00:12] Product owner: Alpha is wholesale and pays eighty dollars. Beta is retail and pays one hundred.\n[00:00:21] Product owner: A quote must always use the requesting account’s own price, even when we cache it.\n[00:00:34] Engineer: We can speed up repeated lookups, but the cache must keep those accounts separate.';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function BusinessContextPanel({ run, onChange }: { run: AnalysisRun; onChange: (workspace: ContextWorkspace) => void }) {
  const [workspace, setWorkspace] = useState<ContextWorkspace>();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ContextImport['kind']>('transcript');
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [quote, setQuote] = useState('');
  const [requirementId, setRequirementId] = useState(run.requirements[0]?.id ?? '');
  const [rationale, setRationale] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const source = workspace?.sources.find(item => item.id === sourceId);
  const segment = source?.segments.find(item => item.id === segmentId);
  const validQuote = !!quote.trim() && !!segment?.text.includes(quote) && quote.length <= 4000;

  function update(next: ContextWorkspace) { setWorkspace(next); onChange(next); }
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    api.businessContext(run.id, abort.signal).then(next => {
      if (!abort.signal.aborted) { setWorkspace(next); onChange(next); setSourceId(next.sources[0]?.id ?? ''); }
    }).catch(error => { if (!abort.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [run.id, onChange]);

  async function mutate(action: (signal: AbortSignal) => Promise<ContextWorkspace>, success: string) {
    const signal = controller.current!.signal;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await action(signal);
      if (signal.aborted) return;
      update(next); setNotice(success);
      return next;
    } catch (error) { if (!signal.aborted) setError(errorMessage(error)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function importText() {
    const next = await mutate(signal => api.importContext(run.id, { title: title.trim(), kind, text, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) }, signal), 'Source available for review. Reimporting the same content does not duplicate it.');
    if (next) {
      const imported = next.sources.find(item => item.text === text) ?? next.sources.at(-1);
      setSourceId(imported?.id ?? ''); setSegmentId(''); setQuote('');
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (!/\.(txt|md|vtt)$/i.test(file.name)) throw new Error('Choose a .txt, .md, or .vtt transcript or notes file.');
      if (file.size > 400_000) throw new Error('Choose a file containing at most 100,000 characters.');
      const content = await file.text();
      if (controller.current?.signal.aborted) return;
      if (content.length > 100_000) throw new Error('Sources are limited to 100,000 characters.');
      setText(content); if (!title) setTitle(file.name);
    } catch (error) { setError(errorMessage(error)); }
  }
  async function propose() {
    const next = await mutate(signal => api.proposeContext(run, { sourceId, segmentId, quote, requirementId, rationale }, signal), 'Proposal created. Review the quote and existing requirement before accepting it.');
    if (next) setRationale('');
  }
  async function review(id: string, decision: ReviewProposal['decision']) {
    await mutate(signal => api.reviewContext(run.id, id, { decision, reviewer, note }, signal), decision === 'accepted' ? 'Supporting context approved. Inspect the linked requirement and its execution evidence below.' : `Proposal marked ${decision}.`);
  }

  return <section className="panel business-context-panel" aria-label="Business context review">
    <div className="panel-heading"><div><span className="eyebrow">Conversation → requirement → evidence</span><h2>Bring the business decision into view</h2></div><span className="subtle-tag">Manual citation review</span></div>
    <p className="context-explanation">Link an exact source quote to an existing requirement. Accepted quotes add supporting context after execution; they do not change the original CI policy or test results.</p>
    {isFixture && <p className="fixture-banner">UI fixture: all sources and approvals here are synthetic, stored only in this browser session.</p>}
    {loading && <p className="muted" role="status">Loading business context…</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="import-notice" role="status">{notice}</p>}
    <div className="context-columns">
      <form className="context-form" onSubmit={event => { event.preventDefault(); void importText(); }}>
        <h3>1. Add a conversation</h3>
        <label>Source title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} placeholder="Pricing decision meeting" /></label>
        <label>Source type<select aria-label="Source type" value={kind} onChange={event => setKind(event.target.value as ContextImport['kind'])}><option value="transcript">Transcript</option><option value="notes">Meeting notes</option><option value="synthetic">Synthetic demo</option></select></label>
        <label>Source link (optional)<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" maxLength={2048} /></label>
        <label>Transcript or notes file<input type="file" accept=".txt,.md,.vtt,text/plain,text/markdown,text/vtt" onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
        <label>Source text<textarea value={text} onChange={event => setText(event.target.value)} required maxLength={100_000} rows={6} placeholder="Paste the conversation or meeting notes here." /></label>
        <span className="context-hint">{text.length.toLocaleString()} / 100,000 characters. Keep available speaker names and timestamps.</span>
        <div className="context-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => { setTitle('Synthetic pricing decision'); setKind('synthetic'); setText(example); setSourceUrl(''); }}>Use synthetic example</button><button className="primary-button" disabled={busy || loading || !title.trim() || !text.trim()}>{busy ? 'Saving…' : 'Import source'}</button></div>
      </form>
      <form className="context-form" onSubmit={event => { event.preventDefault(); void propose(); }}>
        <h3>2. Propose a supporting quote</h3>
        <label>Imported source<select aria-label="Imported source" value={sourceId} onChange={event => { setSourceId(event.target.value); setSegmentId(''); setQuote(''); }} required><option value="">Choose a source</option>{workspace?.sources.map(item => <option key={item.id} value={item.id}>{item.title} · {item.kind}</option>)}</select></label>
        <label>Source segment<select aria-label="Source segment" value={segmentId} onChange={event => { setSegmentId(event.target.value); setQuote(source?.segments.find(item => item.id === event.target.value)?.text.slice(0, 4000) ?? ''); }} required disabled={!source}><option value="">Choose a source segment</option>{source?.segments.map(item => <option key={item.id} value={item.id}>Line {item.line}{item.timestamp ? ` · ${item.timestamp}` : ''} · {item.text.slice(0, 90)}</option>)}</select></label>
        {segment && <blockquote className="source-quote"><p>{segment.text}</p><cite>{source?.title} · line {segment.line}{segment.timestamp ? ` · ${segment.timestamp}` : ''}{segment.speaker ? ` · ${segment.speaker}` : ''}</cite></blockquote>}
        <label>Exact supporting quote<textarea value={quote} onChange={event => setQuote(event.target.value)} rows={3} maxLength={4000} required /></label>
        {quote && !validQuote && <span className="quote-error">The quote must be an exact excerpt of the selected segment.</span>}
        <label>Existing requirement<select aria-label="Existing requirement" value={requirementId} onChange={event => setRequirementId(event.target.value)} required>{run.requirements.map(item => <option value={item.id} key={item.id}>{item.text}</option>)}</select></label>
        <label>Why this quote supports the requirement<textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={3} required maxLength={2000} /></label>
        <button className="primary-button" disabled={busy || loading || !validQuote || !rationale.trim() || !requirementId}>Propose context</button>
        <p className="context-hint">You choose the quote and rule. No AI extraction is performed.</p>
      </form>
    </div>
    <div className="context-review"><h3>3. Review proposed context</h3><div className="review-identity"><label>Reviewer name<input value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} placeholder="Your name" /></label><label>Review note (optional)<input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} placeholder="Reason for accepting, rejecting, or flagging a conflict" /></label></div>
      {!workspace?.proposals.length && <p className="context-hint">Proposals appear here for review. Source text alone never changes a requirement.</p>}
      <div className="proposal-list">{workspace?.proposals.map(proposal => {
        const proposalSource = workspace.sources.find(item => item.id === proposal.sourceId);
        const proposalSegment = proposalSource?.segments.find(item => item.id === proposal.segmentId);
        const alreadyApproved = workspace.approvals.some(item => item.requirementId === proposal.requirementId);
        return <article className="proposal-card" key={proposal.id}><div className="check-heading"><strong>{proposal.requirementText}</strong><span className={`status ${proposal.status === 'accepted' ? 'status-success' : proposal.status === 'conflict' ? 'status-error' : 'status-neutral'}`}>{proposal.status}</span></div><blockquote className="source-quote"><p>{proposal.quote}</p><cite>{proposalSource?.title} · {proposalSource?.kind} · line {proposalSegment?.line}{proposalSegment?.timestamp ? ` · ${proposalSegment.timestamp}` : ''}</cite></blockquote><p>{proposal.rationale}</p>{proposal.status === 'proposed' ? <><div className="context-actions"><button className="primary-button" disabled={busy || !reviewer.trim() || alreadyApproved} onClick={() => void review(proposal.id, 'accepted')}>Approve context</button><button className="secondary-button" disabled={busy || !reviewer.trim()} onClick={() => void review(proposal.id, 'rejected')}>Reject</button><button className="secondary-button" disabled={busy || !reviewer.trim()} onClick={() => void review(proposal.id, 'conflict')}>Mark conflict</button></div>{alreadyApproved && <p className="context-hint">This requirement already has approved context. Review this proposal as rejected or conflicting; approval cannot overwrite the existing version.</p>}</> : <p className="context-hint">Reviewed by {proposal.reviewer}{proposal.reviewNote ? ` · ${proposal.reviewNote}` : ''}</p>}</article>;
      })}</div>
    </div>
  </section>;
}

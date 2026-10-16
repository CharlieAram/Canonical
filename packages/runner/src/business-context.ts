import { createHash, randomUUID } from 'node:crypto';
import {
  ContextImportSchema, CreateProposalSchema, ReviewProposalSchema,
  type AnalysisRun, type ContextWorkspace, type ContextImport, type CreateProposal,
  type ReviewProposal, type ContextSource, type ApprovedContext,
} from '@canonical/contracts';

export class ContextError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'ContextError'; }
}
export function emptyContext(runId: string): ContextWorkspace {
  return { runId, revision: 0, sources: [], proposals: [], approvals: [] };
}

// Keep source text verbatim. Offsets always point into the stored original;
// normalized line endings are used only for content identity.
function segments(text: string, sourceId: string): ContextSource['segments'] {
  const result: ContextSource['segments'] = [];
  let offset = 0;
  let timestamp: string | undefined;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const cue = line.match(/^\s*((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->/);
    if (!line.trim()) timestamp = undefined;
    else if (cue) timestamp = cue[1];
    else if (line.trim() && !/^WEBVTT(?:\s|$)/.test(line) && !/^\d+$/.test(line.trim())) {
      const prefix = line.match(/^\s*\[((?:\d{2}:)?\d{2}:\d{2}(?:\.\d{3})?)\]/);
      const speaker = line.replace(/^\s*\[[^\]]+\]\s*/, '').match(/^([^:<]{1,80}):\s/)
        ?? line.match(/^\s*<v\s+([^>]+)>/);
      result.push({
        id: `${sourceId}-line-${index + 1}`, text: line, line: index + 1,
        start: offset, end: offset + line.length,
        ...(prefix || timestamp ? { timestamp: prefix?.[1] ?? timestamp } : {}),
        ...(speaker ? { speaker: speaker[1] } : {}),
      });
    }
    offset += raw.length + 1;
  }
  return result;
}

export function importContext(workspace: ContextWorkspace, input: ContextImport): ContextWorkspace {
  const parsed = ContextImportSchema.parse(input);
  if (!parsed.text.trim()) throw new ContextError('Enter a transcript or meeting note.');
  const contentHash = createHash('sha256').update(parsed.text.replace(/\r\n?/g, '\n')).digest('hex');
  if (workspace.sources.some(source => source.contentHash === contentHash && source.kind === parsed.kind)) return structuredClone(workspace);
  if (workspace.sources.length >= 8) throw new ContextError('This review already has eight sources. Start a new review for more context.', 409);
  const id = `source-${createHash('sha256').update(`${parsed.kind}:${contentHash}`).digest('hex').slice(0, 24)}`;
  const source: ContextSource = { ...parsed, id, runId: workspace.runId, contentHash, importedAt: new Date().toISOString(), segments: segments(parsed.text, id) };
  if (!source.segments.length) throw new ContextError('No conversation text was found in this source.');
  if (source.segments.length > 1000) throw new ContextError('A source can contain at most 1,000 nonempty text segments. Split the conversation into smaller sources.');
  return { ...structuredClone(workspace), revision: workspace.revision + 1, sources: [...structuredClone(workspace.sources), source] };
}

function assertRun(workspace: ContextWorkspace, run: AnalysisRun) {
  if (workspace.runId !== run.id) throw new ContextError('Context belongs to a different run.', 409);
  if (run.status !== 'completed' && run.status !== 'error') throw new ContextError('Wait until this analysis finishes before reviewing its context.', 409);
}

export function proposeContext(workspace: ContextWorkspace, run: AnalysisRun, input: CreateProposal): ContextWorkspace {
  assertRun(workspace, run);
  const parsed = CreateProposalSchema.parse(input);
  if (workspace.proposals.length >= 100) throw new ContextError('This review already has 100 proposals.', 409);
  const source = workspace.sources.find(source => source.id === parsed.sourceId);
  const segment = source?.segments.find(segment => segment.id === parsed.segmentId);
  if (!source || !segment) throw new ContextError('Choose a source segment from this run.');
  if (!parsed.quote.trim() || !segment.text.includes(parsed.quote) || source.text.slice(segment.start, segment.end) !== segment.text) {
    throw new ContextError('The supporting quote must appear exactly in the selected source segment.');
  }
  const rule = run.requirements.find(rule => rule.id === parsed.requirementId);
  if (!rule) throw new ContextError('Choose an existing requirement from this run.');
  return {
    ...structuredClone(workspace), revision: workspace.revision + 1,
    proposals: [...structuredClone(workspace.proposals), {
      ...parsed, id: randomUUID(), runId: run.id, requirementText: rule.text, conceptIds: [...rule.conceptIds],
      status: 'proposed', createdAt: new Date().toISOString(), method: 'manual',
    }],
  };
}

export function reviewContext(workspace: ContextWorkspace, run: AnalysisRun, proposalId: string, input: ReviewProposal): ContextWorkspace {
  assertRun(workspace, run);
  const parsed = ReviewProposalSchema.parse(input);
  const proposal = workspace.proposals.find(proposal => proposal.id === proposalId);
  if (!proposal) throw new ContextError('Proposal not found in this run.', 404);
  if (proposal.status !== 'proposed') throw new ContextError('This proposal has already been reviewed. Its decision is immutable.', 409);
  const next = structuredClone(workspace);
  const reviewed = next.proposals.find(item => item.id === proposal.id)!;
  const now = new Date().toISOString();
  reviewed.status = parsed.decision;
  reviewed.reviewer = parsed.reviewer;
  reviewed.reviewedAt = now;
  reviewed.reviewNote = parsed.note;
  if (parsed.decision === 'accepted') {
    if (workspace.approvals.some(item => item.requirementId === proposal.requirementId)) {
      throw new ContextError('This requirement already has approved context. Mark conflicting proposals explicitly; existing approval cannot be replaced.', 409);
    }
    const rule = run.requirements.find(rule => rule.id === proposal.requirementId);
    if (!rule || rule.text !== proposal.requirementText || JSON.stringify(rule.conceptIds) !== JSON.stringify(proposal.conceptIds)) {
      throw new ContextError('The requirement changed since this proposal was created.', 409);
    }
    const source = workspace.sources.find(source => source.id === proposal.sourceId)!;
    const segment = source?.segments.find(segment => segment.id === proposal.segmentId);
    if (!source || !segment || !segment.text.includes(proposal.quote)) throw new ContextError('The original citation is unavailable.', 409);
    const { text: _text, segments: _segments, ...metadata } = source;
    const approval: ApprovedContext = {
      id: randomUUID(), runId: run.id, proposalId: proposal.id,
      requirementId: rule.id, requirementText: rule.text, conceptIds: [...rule.conceptIds], version: 1,
      rationale: proposal.rationale, approvedAt: now, reviewer: parsed.reviewer,
      source: metadata, segment: structuredClone(segment), quote: proposal.quote, association: 'reviewed-context',
    };
    next.approvals.push(approval);
  }
  next.revision++;
  return next;
}

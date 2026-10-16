import type { AnalysisRun, ContextImport, ContextWorkspace, CreateProposal, ReviewProposal } from '@canonical/contracts';

// Browser-only illustration for UI development; never persisted or sent to the API.
const workspaces = new Map<string, ContextWorkspace>();
export function fixtureWorkspace(runId: string): ContextWorkspace {
  return structuredClone(workspaces.get(runId) ?? { runId, revision: 0, sources: [], proposals: [], approvals: [] });
}
function save(workspace: ContextWorkspace) {
  workspace.revision++;
  workspaces.set(workspace.runId, structuredClone(workspace));
  return workspace;
}
export async function fixtureImport(runId: string, input: ContextImport) {
  const workspace = fixtureWorkspace(runId);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.text));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (workspace.sources.some(source => source.contentHash === contentHash)) return workspace;
  let offset = 0;
  const segments = input.text.split('\n').flatMap((text, index) => {
    const start = offset; offset += text.length + 1;
    return text.trim() ? [{ id: crypto.randomUUID(), text, line: index + 1, start, end: start + text.length }] : [];
  });
  workspace.sources.push({ ...input, id: crypto.randomUUID(), runId, kind: 'synthetic', contentHash, importedAt: new Date().toISOString(), segments });
  return save(workspace);
}
export function fixturePropose(run: AnalysisRun, input: CreateProposal) {
  const workspace = fixtureWorkspace(run.id);
  const segment = workspace.sources.find(source => source.id === input.sourceId)?.segments.find(segment => segment.id === input.segmentId);
  const requirement = run.requirements.find(requirement => requirement.id === input.requirementId);
  if (!requirement || !segment || !segment.text.includes(input.quote)) throw new Error('Choose an existing requirement and an exact source quote.');
  workspace.proposals.push({ ...input, id: crypto.randomUUID(), runId: run.id, requirementText: requirement.text, conceptIds: requirement.conceptIds, status: 'proposed', createdAt: new Date().toISOString(), method: 'manual' });
  return save(workspace);
}
export function fixtureReview(runId: string, proposalId: string, input: ReviewProposal) {
  const workspace = fixtureWorkspace(runId);
  const proposal = workspace.proposals.find(item => item.id === proposalId);
  if (!proposal || proposal.status !== 'proposed') throw new Error('This proposal has already been reviewed.');
  if (input.decision === 'accepted' && workspace.approvals.some(item => item.requirementId === proposal.requirementId)) throw new Error('This requirement already has reviewed context. Mark the new proposal as a conflict.');
  proposal.status = input.decision; proposal.reviewer = input.reviewer; proposal.reviewNote = input.note; proposal.reviewedAt = new Date().toISOString();
  if (input.decision === 'accepted') {
    const source = workspace.sources.find(item => item.id === proposal.sourceId)!;
    const segment = source.segments.find(item => item.id === proposal.segmentId)!;
    const { text: _text, segments: _segments, ...sourceMetadata } = source;
    workspace.approvals.push({ id: crypto.randomUUID(), runId, proposalId, requirementId: proposal.requirementId, requirementText: proposal.requirementText, conceptIds: proposal.conceptIds, version: 1, rationale: proposal.rationale, approvedAt: proposal.reviewedAt, reviewer: input.reviewer, source: sourceMetadata, segment, quote: proposal.quote, association: 'reviewed-context' });
  }
  return save(workspace);
}

import { z } from 'zod';

const Id = z.string().min(1).max(160);
export const ContextSourceKindSchema = z.enum(['transcript', 'notes', 'synthetic']);
export const ContextImportSchema = z.object({
  title: z.string().trim().min(1).max(160), kind: ContextSourceKindSchema,
  text: z.string().min(1).max(100_000),
  sourceUrl: z.string().url().max(2048).refine(value => /^https?:\/\//.test(value)).optional(),
}).strict();
export const ContextSegmentSchema = z.object({
  id: Id, text: z.string(), line: z.number().int().positive(),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  timestamp: z.string().optional(), speaker: z.string().optional(),
});
export const ContextSourceSchema = ContextImportSchema.extend({
  id: Id, runId: Id, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string().datetime(), segments: z.array(ContextSegmentSchema),
});
export const CreateProposalSchema = z.object({
  sourceId: Id, segmentId: Id,
  quote: z.string().min(1).max(4000),
  requirementId: Id,
  rationale: z.string().trim().min(1).max(2000),
}).strict();
export const ContextProposalSchema = CreateProposalSchema.extend({
  id: Id, runId: Id, requirementText: z.string(), conceptIds: z.array(Id),
  status: z.enum(['proposed', 'accepted', 'rejected', 'conflict']),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().optional(), reviewer: z.string().optional(),
  reviewNote: z.string().optional(), method: z.literal('manual'),
});
export const ReviewProposalSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'conflict']),
  reviewer: z.string().trim().min(1).max(100),
  note: z.string().trim().max(2000).default(''),
}).strict();
export const ApprovedContextSchema = z.object({
  id: Id, runId: Id, proposalId: Id, requirementId: Id, requirementText: z.string(),
  conceptIds: z.array(Id), version: z.literal(1),
  rationale: z.string(), approvedAt: z.string().datetime(), reviewer: z.string(),
  source: ContextSourceSchema.omit({ text: true, segments: true }),
  segment: ContextSegmentSchema, quote: z.string(),
  association: z.literal('reviewed-context'),
});
export const ContextWorkspaceSchema = z.object({
  runId: Id, revision: z.number().int().nonnegative(),
  sources: z.array(ContextSourceSchema), proposals: z.array(ContextProposalSchema),
  approvals: z.array(ApprovedContextSchema),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type ContextProposal = z.infer<typeof ContextProposalSchema>;
export type ApprovedContext = z.infer<typeof ApprovedContextSchema>;
export type ContextWorkspace = z.infer<typeof ContextWorkspaceSchema>;
export type ContextImport = z.infer<typeof ContextImportSchema>;
export type CreateProposal = z.infer<typeof CreateProposalSchema>;
export type ReviewProposal = z.infer<typeof ReviewProposalSchema>;

export interface ContextStore {
  provenance?(runId: string, requirementId: string): Promise<ApprovedContext[]>;
  get(runId: string): Promise<ContextWorkspace | undefined>;
  // Compare-and-swap; returns false when another request changed this workspace.
  save(workspace: ContextWorkspace, expectedRevision: number): Promise<boolean>;
}

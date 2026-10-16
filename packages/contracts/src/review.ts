import { z } from 'zod';

export const SourceCitationSchema = z.object({
  path: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  excerpt: z.string(),
});
export const ExtractedNodeSchema = z.object({
  id: z.string(), label: z.string(), kind: z.string(), description: z.string(),
  properties: z.record(z.string(), z.string()), citations: z.array(SourceCitationSchema),
});
export const ExtractedEdgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string(), label: z.string() });
export const LayerSnapshotSchema = z.object({ nodes: z.array(ExtractedNodeSchema), edges: z.array(ExtractedEdgeSchema) });
export const LayerDiffSchema = z.object({
  provenance: z.enum(['static-analysis', 'model-inference']),
  before: LayerSnapshotSchema, after: LayerSnapshotSchema,
  changes: z.array(z.object({
    id: z.string(), entity: z.enum(['node', 'edge']),
    change: z.enum(['added', 'removed', 'modified', 'unchanged']),
  })),
  summary: z.string(), limitations: z.array(z.string()),
  model: z.object({
    provider: z.literal('openai'), name: z.string(), responseId: z.string(),
    responseIds: z.array(z.string()).optional(),
    attempts: z.number().int().min(1).max(2).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  }).optional(),
});
export const AgentIdSchema = z.enum(['objects', 'logic', 'business-checks']);
export const ReviewAgentSchema = z.object({
  id: AgentIdSchema, label: z.string(),
  method: z.enum(['static-analysis', 'model', 'daytona']),
  status: z.enum(['queued', 'running', 'completed', 'error']),
  startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional(),
  message: z.string(),
});
export const BusinessEntrySchema = z.object({
  id: z.string(), text: z.string(), conceptIds: z.array(z.string()),
  status: z.enum(['pending', 'passed', 'failed', 'error']),
  baselineStatus: z.enum(['pending', 'passed', 'failed', 'error']),
  candidateStatus: z.enum(['pending', 'passed', 'failed', 'error']),
  evidence: z.array(z.object({
    variant: z.enum(['baseline', 'candidate']), checkId: z.string(),
    status: z.enum(['passed', 'failed']), expected: z.string(), actual: z.string(),
    commitSha: z.string().optional(),
  })),
});
export const ReviewSchema = z.object({
  version: z.literal(1), sequence: z.number().int().nonnegative(),
  agents: z.array(ReviewAgentSchema),
  objects: LayerDiffSchema.optional(), logic: LayerDiffSchema.optional(),
  billOfBusiness: z.array(BusinessEntrySchema),
  events: z.array(z.object({
    sequence: z.number().int().positive(), at: z.string().datetime(),
    agentId: AgentIdSchema.optional(), message: z.string(),
  })),
  trigger: z.object({ kind: z.enum(['cli', 'github']), url: z.string().url().optional(), attempt: z.string().optional() }).optional(),
});
export type SourceCitation = z.infer<typeof SourceCitationSchema>;
export type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;
export type LayerSnapshot = z.infer<typeof LayerSnapshotSchema>;
export type LayerDiff = z.infer<typeof LayerDiffSchema>;
export type ReviewAgent = z.infer<typeof ReviewAgentSchema>;
export type BusinessEntry = z.infer<typeof BusinessEntrySchema>;
export type Review = z.infer<typeof ReviewSchema>;
export interface RevisionSource { sha: string; path: string; content: string }

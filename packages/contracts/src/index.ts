import type { ContextStore } from './context.ts';
export * from './context.ts';
import { z } from 'zod';

// This is the UI/backend handoff. Keep SDK types and credentials out of here.
export const ExecutionModeSchema = z.enum(['local', 'daytona']);
export const VariantSchema = z.enum(['baseline', 'candidate']);
export const StartRunSchema = z.object({
  execution: ExecutionModeSchema.default('local'),
  scenario: z.literal('pricing-cache').default('pricing-cache'),
}).strict();

export const ConceptSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  change: z.enum(['unchanged', 'modified', 'added']),
  impact: z.enum(['none', 'potential', 'failed']),
  position: z.object({ x: z.number(), y: z.number() }),
});
export const RelationshipSchema = z.object({
  id: z.string(), source: z.string(), target: z.string(), label: z.string(),
  change: z.enum(['unchanged', 'modified', 'added']),
});
export const GraphSchema = z.object({
  provenance: z.enum(['declared-fixture', 'declared-policy']),
  nodes: z.array(ConceptSchema),
  edges: z.array(RelationshipSchema),
});
export const RequirementSchema = z.object({
  id: z.string(), text: z.string(), conceptIds: z.array(z.string()),
});
export const CheckSchema = z.object({
  id: z.string(), requirementId: z.string(), label: z.string(),
  conceptIds: z.array(z.string()), status: z.enum(['passed', 'failed']),
  expected: z.string(), actual: z.string(),
});
export const EvaluationSchema = z.object({
  variant: VariantSchema,
  checks: z.array(CheckSchema),
  benchmark: z.object({
    label: z.string(), unit: z.literal('ms'),
    samples: z.array(z.number().finite().nonnegative()).min(1),
    median: z.number().finite().nonnegative(),
    p95: z.number().finite().nonnegative(),
    upstreamCalls: z.number().int().nonnegative(),
    simulatedUpstreamMs: z.number().nonnegative(),
  }),
  runtime: z.string(),
  sandboxId: z.string().optional(),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  warnings: z.array(z.string()).default([]),
});
export const RunSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'error']),
  stage: z.string(),
  execution: ExecutionModeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixture'), name: z.string(), baseline: z.string(), candidate: z.string() }),
    z.object({
      kind: z.literal('git'), name: z.string(), baseline: z.string(), candidate: z.string(),
      baseSha: z.string().regex(/^[a-f0-9]{40}$/), headSha: z.string().regex(/^[a-f0-9]{40}$/),
      changedFiles: z.array(z.string()), policyPath: z.literal('.canonical/business.json'),
    }),
  ]),
  graph: GraphSchema,
  requirements: z.array(RequirementSchema),
  results: z.array(EvaluationSchema),
  error: z.string().optional(),
});
export const HealthSchema = z.object({
  status: z.literal('ok'),
  storage: z.enum(['memory', 'surreal']),
  executionModes: z.array(ExecutionModeSchema),
});

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type StartRun = z.infer<typeof StartRunSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type AnalysisRun = z.infer<typeof RunSchema>;
export type Health = z.infer<typeof HealthSchema>;

// Persistence seam for backend work. The browser only depends on the HTTP API.
export interface RunStore {
  readonly kind: 'memory' | 'surreal';
  readonly context?: ContextStore;
  save(run: AnalysisRun): Promise<void>;
  get(id: string): Promise<AnalysisRun | undefined>;
  list(): Promise<AnalysisRun[]>;
  close(): Promise<void>;
}

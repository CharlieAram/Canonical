import { HealthSchema, ReviewSchema, RunSchema, type AnalysisRun, type ExecutionMode, type Health } from '@canonical/contracts';
import { createUiFixture } from '@canonical/demo';
import reviewFixture from './review-fixture.json';
import { ContextWorkspaceSchema, ContextImportSchema, CreateProposalSchema, ReviewProposalSchema, type ContextWorkspace, type ContextImport, type CreateProposal, type ReviewProposal } from '@canonical/contracts';
import { fixtureWorkspace, fixtureImport, fixturePropose, fixtureReview } from './context-fixture';

// The only UI/backend boundary. Never put server credentials in VITE_* variables.
export const isFixture = import.meta.env.VITE_DATA_SOURCE === 'fixture';
// Fixture review produced once by the real static extractor (packages/runner/src/extraction.ts).
const withReview = (run: AnalysisRun): AnalysisRun => ({ ...run, review: ReviewSchema.parse(reviewFixture) });
const fixtureRuns: AnalysisRun[] = [withReview(createUiFixture())];

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 300) || response.statusText;
    try { const parsed = JSON.parse(body); if (typeof parsed.error === 'string') detail = parsed.error; } catch { /* Non-JSON errors retain their text. */ }
    throw new Error(`API ${response.status}: ${detail}`);
  }
  return response;
}

export const api = {
  subscribeRuns(onRuns: (runs: AnalysisRun[]) => void, onError: (message: string) => void): () => void {
    if (isFixture) return () => {};
    const stream = new EventSource('/api/events');
    stream.addEventListener('runs', event => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        onRuns(RunSchema.array().parse(data.runs));
      } catch { onError('Live review data could not be read. Reconnecting will refresh the current state.'); }
    });
    stream.addEventListener('error', () => onError('Live updates are reconnecting. Existing review evidence remains available.'));
    return () => stream.close();
  },
  async businessContext(id: string, signal?: AbortSignal): Promise<ContextWorkspace> {
    if (isFixture) return fixtureWorkspace(id);
    return ContextWorkspaceSchema.parse(await (await request(`/runs/${encodeURIComponent(id)}/business-context`, { signal })).json());
  },
  async importContext(id: string, input: ContextImport, signal?: AbortSignal): Promise<ContextWorkspace> {
    const body = ContextImportSchema.parse(input);
    if (isFixture) return fixtureImport(id, body);
    return ContextWorkspaceSchema.parse(await (await request(`/runs/${encodeURIComponent(id)}/business-context/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })).json());
  },
  async proposeContext(run: AnalysisRun, input: CreateProposal, signal?: AbortSignal): Promise<ContextWorkspace> {
    const body = CreateProposalSchema.parse(input);
    if (isFixture) return fixturePropose(run, body);
    return ContextWorkspaceSchema.parse(await (await request(`/runs/${encodeURIComponent(run.id)}/business-context/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })).json());
  },
  async reviewContext(id: string, proposalId: string, input: ReviewProposal, signal?: AbortSignal): Promise<ContextWorkspace> {
    const body = ReviewProposalSchema.parse(input);
    if (isFixture) return fixtureReview(id, proposalId, body);
    return ContextWorkspaceSchema.parse(await (await request(`/runs/${encodeURIComponent(id)}/business-context/proposals/${encodeURIComponent(proposalId)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })).json());
  },
  async health(signal?: AbortSignal): Promise<Health> {
    if (isFixture) return { status: 'ok', storage: 'memory', executionModes: ['local'] };
    return HealthSchema.parse(await (await request('/health', { signal })).json());
  },
  async listRuns(signal?: AbortSignal): Promise<AnalysisRun[]> {
    if (isFixture) return [...fixtureRuns];
    const body: unknown = await (await request('/runs', { signal })).json();
    if (!body || typeof body !== 'object' || !('runs' in body)) throw new Error('Invalid runs response');
    return RunSchema.array().parse(body.runs);
  },
  async getRun(id: string, signal?: AbortSignal): Promise<AnalysisRun> {
    if (isFixture) {
      const run = fixtureRuns.find(run => run.id === id);
      if (!run) throw new Error('Fixture not found');
      return run;
    }
    return RunSchema.parse(await (await request(`/runs/${encodeURIComponent(id)}`, { signal })).json());
  },
  async startRun(execution: ExecutionMode): Promise<AnalysisRun> {
    if (isFixture) {
      const run = { ...withReview(createUiFixture()), id: `ui-fixture-${crypto.randomUUID()}` };
      fixtureRuns.unshift(run);
      return run;
    }
    return RunSchema.parse(await (await request('/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution, scenario: 'pricing-cache' }),
    })).json());
  },
  async importRun(report: unknown): Promise<AnalysisRun> {
    const parsed = RunSchema.safeParse(report);
    if (!parsed.success) throw new Error('This JSON does not match a Canonical report. Choose report.json from the analysis output.');
    const run = parsed.data;
    if (run.status !== 'completed' && run.status !== 'error') throw new Error('Only completed or error reports can be imported. Wait for the analysis to finish.');
    if (isFixture) throw new Error('Report import requires the backend. Start the app with npm run dev.');
    return RunSchema.parse(await (await request('/runs/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    })).json());
  },
  async context(id: string): Promise<string> {
    if (isFixture) {
      const run = await this.getRun(id);
      const workspace = fixtureWorkspace(id);
      return ['# Canonical — SYNTHETIC UI FIXTURE', '', 'Illustrative data only. No code was executed.', '', '## Approved requirements', ...run.requirements.map(item => `- ${item.text}`), '', '## Illustrative failure', 'Retail must receive $100; the product-only cache returns $80. Include account identity in the cache key.', '', '## Reviewed supporting context (synthetic)', 'Added after execution; not original CI input.', ...workspace.approvals.map(item => `\n${item.requirementText}\n> ${item.quote}\nSource: ${item.source.title}, line ${item.segment.line}. Reviewed by ${item.reviewer}.`)].join('\n');
    }
    return (await request(`/runs/${encodeURIComponent(id)}/context`)).text();
  },
};

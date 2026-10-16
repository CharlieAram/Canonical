import { HealthSchema, RunSchema, type AnalysisRun, type ExecutionMode, type Health } from '@canonical/contracts';
import { createUiFixture } from '@canonical/demo';

// The only UI/backend boundary. Never put server credentials in VITE_* variables.
export const isFixture = import.meta.env.VITE_DATA_SOURCE === 'fixture';
const fixtureRuns: AnalysisRun[] = [createUiFixture()];

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body.slice(0, 300) || response.statusText}`);
  }
  return response;
}

export const api = {
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
      const run = { ...createUiFixture(), id: `ui-fixture-${crypto.randomUUID()}` };
      fixtureRuns.unshift(run);
      return run;
    }
    return RunSchema.parse(await (await request('/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution, scenario: 'pricing-cache' }),
    })).json());
  },
  async context(id: string): Promise<string> {
    if (isFixture) {
      const run = await this.getRun(id);
      return ['# Canonical — SYNTHETIC UI FIXTURE', '', 'Illustrative data only. No code was executed.', '', '## Approved requirements', ...run.requirements.map(item => `- ${item.text}`), '', '## Illustrative failure', 'Retail must receive $100; the product-only cache returns $80. Include account identity in the cache key.'].join('\n');
    }
    return (await request(`/runs/${encodeURIComponent(id)}/context`)).text();
  },
};

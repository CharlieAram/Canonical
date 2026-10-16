import { readFile } from 'node:fs/promises';
import { Daytona } from '@daytona/sdk';
import { EvaluationSchema, VariantSchema, type Evaluation, type Variant } from '@canonical/contracts';

// Official reference: https://www.daytona.io/docs/en/typescript-sdk/
// Keep all Daytona calls here. Nothing in this module is imported by the UI.
export interface DaytonaConfig {
  apiKey: string;
  apiUrl?: string;
  snapshot?: string;
}

export async function evaluateWithDaytona(variant: Variant, config: DaytonaConfig): Promise<Evaluation> {
  VariantSchema.parse(variant);
  if (!config.apiKey) throw new Error('DAYTONA_API_KEY is required for Daytona execution');
  const daytona = new Daytona({ apiKey: config.apiKey, apiUrl: config.apiUrl, requestTimeoutMs: 60_000 });
  const sandbox = await daytona.create({
    language: 'javascript',
    ...(config.snapshot ? { snapshot: config.snapshot } : {}),
    labels: { project: 'canonical', scenario: 'pricing-cache', variant },
    autoStopInterval: 10,
    autoDeleteInterval: 0,
  }, { timeout: 90 });
  let result: Evaluation | undefined;
  try {
    await sandbox.setTtl(20);
    const setup = await sandbox.process.executeCommand(
      'mkdir -p /tmp/canonical/checks /tmp/canonical/examples/quote-shop',
      undefined, undefined, 30,
    );
    if (setup.exitCode !== 0) throw new Error(`Sandbox setup failed (${setup.exitCode})`);
    // Upload only the trusted fixture and harness. No credentials or arbitrary repo code.
    await sandbox.fs.uploadFile(await readFile(new URL('../checks/pricing.mjs', import.meta.url)), '/tmp/canonical/checks/pricing.mjs');
    await sandbox.fs.uploadFile(await readFile(new URL('../examples/quote-shop/service.mjs', import.meta.url)), '/tmp/canonical/examples/quote-shop/service.mjs');
    const response = await sandbox.process.executeCommand(
      `node /tmp/canonical/checks/pricing.mjs ${variant}`, undefined, undefined, 60,
    );
    if (response.exitCode !== 0) throw new Error(`Pricing harness failed in Daytona (${response.exitCode})`);
    result = EvaluationSchema.parse(JSON.parse(response.result));
    result.sandboxId = sandbox.id;
    return result;
  } finally {
    try {
      await daytona.delete(sandbox, 60);
    } catch {
      const warning = `Cleanup failed for Daytona sandbox ${sandbox.id}; inspect it in the Daytona dashboard. TTL is the fallback.`;
      if (result) result.warnings.push(warning);
      else console.error(warning);
    }
  }
}

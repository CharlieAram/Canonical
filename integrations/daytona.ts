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

type Sandbox = Awaited<ReturnType<Daytona['create']>>;

async function inSandbox(
  variant: Variant, config: DaytonaConfig, evaluate: (sandbox: Sandbox) => Promise<Evaluation>,
): Promise<Evaluation> {
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
    result = await evaluate(sandbox);
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

export async function evaluateWithDaytona(variant: Variant, config: DaytonaConfig): Promise<Evaluation> {
  return inSandbox(variant, config, async sandbox => {
    const setup = await sandbox.process.executeCommand(
      'mkdir -p /tmp/canonical/checks /tmp/canonical/examples/quote-shop', undefined, undefined, 30,
    );
    if (setup.exitCode !== 0) throw new Error(`Sandbox setup failed (${setup.exitCode})`);
    await sandbox.fs.uploadFile(await readFile(new URL('../checks/pricing.mjs', import.meta.url)), '/tmp/canonical/checks/pricing.mjs');
    await sandbox.fs.uploadFile(await readFile(new URL('../examples/quote-shop/service.mjs', import.meta.url)), '/tmp/canonical/examples/quote-shop/service.mjs');
    const response = await sandbox.process.executeCommand(
      `node /tmp/canonical/checks/pricing.mjs ${variant}`, undefined, undefined, 60,
    );
    if (response.exitCode !== 0) throw new Error(`Pricing harness failed in Daytona (${response.exitCode})`);
    return EvaluationSchema.parse(JSON.parse(response.result));
  });
}

export interface RepositoryRevision {
  bundlePath: string;
  sha: string;
}

// Official file/process APIs:
// https://www.daytona.io/docs/en/typescript-sdk/file-system/
// https://www.daytona.io/docs/en/typescript-sdk/process/
export async function evaluateRepositoryWithDaytona(
  variant: Variant, revision: RepositoryRevision, config: DaytonaConfig,
): Promise<Evaluation> {
  if (!/^[a-f0-9]{40}$/.test(revision.sha)) throw new Error('A full Git commit SHA is required');
  return inSandbox(variant, config, async sandbox => {
    const setup = await sandbox.process.executeCommand('mkdir -p /tmp/canonical/checks', undefined, undefined, 30);
    if (setup.exitCode !== 0) throw new Error(`Sandbox setup failed (${setup.exitCode})`);
    // Upload committed history only. Local environment, Git config and uncommitted
    // files stay on the host; no provider credentials are injected into the sandbox.
    await sandbox.fs.uploadFile(await readFile(revision.bundlePath), '/tmp/canonical/repository.bundle');
    await sandbox.fs.uploadFile(await readFile(new URL('../checks/repository-pricing.mjs', import.meta.url)), '/tmp/canonical/checks/repository-pricing.mjs');
    const clone = await sandbox.process.executeCommand(
      'git clone --quiet --no-checkout /tmp/canonical/repository.bundle /tmp/canonical/repo', undefined, undefined, 30,
    );
    if (clone.exitCode !== 0) throw new Error(`Repository clone failed in Daytona (${clone.exitCode})`);
    // sha is validated hex, variant is validated by inSandbox; no user shell command.
    const checkout = await sandbox.process.executeCommand(
      `git -C /tmp/canonical/repo checkout --quiet --detach ${revision.sha}`, undefined, undefined, 30,
    );
    if (checkout.exitCode !== 0) throw new Error(`Repository checkout failed in Daytona (${checkout.exitCode})`);
    const head = await sandbox.process.executeCommand('git -C /tmp/canonical/repo rev-parse HEAD', undefined, undefined, 30);
    if (head.exitCode !== 0 || head.result.trim() !== revision.sha) throw new Error('Harness checkout does not match requested commit');
    const response = await sandbox.process.executeCommand(
      `node /tmp/canonical/checks/repository-pricing.mjs ${variant}`, undefined, undefined, 60,
    );
    if (response.exitCode !== 0) throw new Error(`Repository harness failed in Daytona (${response.exitCode})`);
    const result = EvaluationSchema.parse(JSON.parse(response.result));
    result.commitSha = revision.sha;
    return result;
  });
}

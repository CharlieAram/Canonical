import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EvaluationSchema, VariantSchema, type Variant } from '@canonical/contracts';

const execute = promisify(execFile);

export async function evaluateLocally(variant: Variant) {
  VariantSchema.parse(variant);
  // Only our trusted fixture runs locally. Repository execution belongs in Daytona.
  const harness = fileURLToPath(new URL('../../../checks/pricing.mjs', import.meta.url));
  const { stdout } = await execute(process.execPath, [harness, variant], {
    timeout: 30_000, maxBuffer: 1_000_000,
    env: { PATH: process.env.PATH },
  });
  return EvaluationSchema.parse(JSON.parse(stdout));
}

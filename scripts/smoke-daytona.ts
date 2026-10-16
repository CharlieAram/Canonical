import { evaluateWithDaytona } from '@canonical/integrations/daytona';
import { readConfig } from '../apps/api/src/config.ts';

const { daytona } = readConfig();
if (!daytona) throw new Error('Set DAYTONA_API_KEY in .env before running this smoke check.');
const result = await evaluateWithDaytona('baseline', daytona);
if (result.checks.some(check => check.status !== 'passed')) throw new Error('Baseline business checks failed');
console.log(`Daytona verified: ${result.checks.length} checks passed; sandbox ${result.sandboxId} cleanup requested.`);
result.warnings.forEach(warning => console.warn(warning));

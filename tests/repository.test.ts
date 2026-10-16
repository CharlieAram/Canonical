import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { createRun } from '@canonical/demo';
import { prepareRepositoryComparison } from '../packages/runner/src/repository.ts';
import { evaluateRepositoryWithDaytona } from '../integrations/daytona.ts';

const exec = promisify(execFile);

test('repository comparison pins commits and baseline policy without changing the working tree', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'canonical-repository-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = async (...args: string[]) => (await exec('git', ['-C', directory, ...args])).stdout.trim();
  await git('init', '--quiet', '--initial-branch=main');
  await git('config', 'user.email', 'canonical-test@example.invalid');
  await git('config', 'user.name', 'Canonical test');
  await mkdir(join(directory, '.canonical'));
  await mkdir(join(directory, 'src'));
  const fixture = createRun('policy-fixture', 'daytona');
  const policy = { version: 1, harness: 'pricing-v1', graph: fixture.graph, requirements: fixture.requirements };
  await writeFile(join(directory, '.canonical/business.json'), JSON.stringify(policy));
  await writeFile(join(directory, 'src/pricing.mjs'), 'export const revision = "baseline";\n');
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'baseline');
  const baseSha = await git('rev-parse', 'HEAD');
  await git('checkout', '--quiet', '-b', 'candidate');
  await writeFile(join(directory, 'src/pricing.mjs'), 'export const revision = "candidate";\n');
  await writeFile(join(directory, '.canonical/business.json'), JSON.stringify({ ...policy, requirements: [] }));
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'candidate attempts to weaken policy');
  const headSha = await git('rev-parse', 'HEAD');
  await writeFile(join(directory, '.env'), 'LOCAL_ONLY=not-for-the-sandbox\n');
  await writeFile(join(directory, 'src/pricing.mjs'), '// uncommitted local work\n');
  const statusBefore = await git('status', '--porcelain');
  const prepared = await prepareRepositoryComparison(directory, 'main', 'candidate');
  t.after(() => prepared.dispose());
  assert.equal(prepared.baseSha, baseSha);
  assert.equal(prepared.headSha, headSha);
  assert.deepEqual(prepared.policy.requirements, policy.requirements);
  assert.deepEqual(prepared.changedFiles.sort(), ['.canonical/business.json', 'src/pricing.mjs']);
  assert.equal(await git('status', '--porcelain'), statusBefore);
  assert.equal(await git('branch', '--show-current'), 'candidate');
  assert.equal(await readFile(join(directory, 'src/pricing.mjs'), 'utf8'), '// uncommitted local work\n');

  const clone = join(directory, 'bundle-clone');
  await exec('git', ['clone', '--quiet', '--no-checkout', prepared.bundlePath, clone]);
  await exec('git', ['-C', clone, 'checkout', '--quiet', '--detach', headSha]);
  assert.equal((await exec('git', ['-C', clone, 'rev-parse', 'HEAD'])).stdout.trim(), headSha);
  assert.equal(await readFile(join(clone, 'src/pricing.mjs'), 'utf8'), 'export const revision = "candidate";\n');
  await assert.rejects(access(join(clone, '.env')));
  await exec('git', ['-C', clone, 'checkout', '--quiet', '--detach', baseSha]);
  assert.equal(await readFile(join(clone, 'src/pricing.mjs'), 'utf8'), 'export const revision = "baseline";\n');
  await assert.rejects(prepareRepositoryComparison(directory, '--all', 'candidate'));
  await assert.rejects(prepareRepositoryComparison(directory, 'missing-ref', 'candidate'));
  await assert.rejects(prepareRepositoryComparison(directory, 'candidate', 'candidate'), /all three/);
  await prepared.dispose();
  await assert.rejects(access(prepared.bundlePath));
});

test('Daytona repository evaluation rejects untrusted revision text before provider access', async () => {
  await assert.rejects(evaluateRepositoryWithDaytona('baseline', {
    bundlePath: '/does-not-exist', sha: 'HEAD; echo unexpected',
  }, { apiKey: '' }), /full Git commit SHA/);
});

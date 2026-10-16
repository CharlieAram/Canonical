import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { ConceptSchema, RelationshipSchema, RequirementSchema } from '@canonical/contracts';

const exec = promisify(execFile);
const fullSha = /^[a-f0-9]{40}$/;
const requiredIds = ['account-price', 'positive-quantity', 'repeat-price'];

export interface RepositoryPolicy {
  version: 1;
  harness: 'pricing-v1';
  requirements: Array<ReturnType<typeof RequirementSchema.parse>>;
  graph: {
    nodes: Array<ReturnType<typeof ConceptSchema.parse>>;
    edges: Array<ReturnType<typeof RelationshipSchema.parse>>;
  };
}

export interface PreparedRepositoryComparison {
  baseSha: string;
  headSha: string;
  repositoryName: string;
  changedFiles: string[];
  policy: RepositoryPolicy;
  bundlePath: string;
  dispose(): Promise<void>;
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await exec('git', ['--no-optional-locks', '-C', cwd, ...args], {
    timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function parsePolicy(contents: string): RepositoryPolicy {
  const value = JSON.parse(contents);
  if (value?.version !== 1 || value?.harness !== 'pricing-v1') {
    throw new Error('Repository policy must declare version 1 and harness pricing-v1');
  }
  const requirements = RequirementSchema.array().parse(value.requirements);
  const nodes = ConceptSchema.array().parse(value.graph?.nodes);
  const edges = RelationshipSchema.array().parse(value.graph?.edges);
  if (JSON.stringify(requirements.map(rule => rule.id).sort()) !== JSON.stringify(requiredIds)) {
    throw new Error('Repository policy must declare all three pricing-v1 requirements exactly once');
  }
  const nodeIds = new Set(nodes.map(node => node.id));
  if (nodeIds.size !== nodes.length || !nodeIds.has('quote') || !nodeIds.has('cache') ||
      requirements.some(rule => rule.conceptIds.some(id => !nodeIds.has(id))) ||
      edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) {
    throw new Error('Repository policy graph must contain unique concepts and valid references');
  }
  return { version: 1, harness: 'pricing-v1', requirements, graph: { nodes, edges } };
}

// Only inspect Git objects here. Repository code is executed exclusively in Daytona.
// Policy comes from the reviewed baseline; a candidate cannot weaken its own checks.
export async function prepareRepositoryComparison(
  repoPath: string, baseRef: string, headRef: string,
): Promise<PreparedRepositoryComparison> {
  const repositoryPath = await realpath(repoPath);
  if (await git(repositoryPath, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    throw new Error('Repository path must be a Git working tree');
  }
  const resolveCommit = async (ref: string) => {
    if (!ref || ref.length > 256 || ref.includes('\0')) throw new Error('Invalid Git reference');
    const sha = await git(repositoryPath, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    if (!fullSha.test(sha)) throw new Error('Only full SHA-1 Git commit identifiers are supported');
    return sha;
  };
  const [baseSha, headSha] = await Promise.all([resolveCommit(baseRef), resolveCommit(headRef)]);
  const policy = parsePolicy(await git(repositoryPath, ['show', `${baseSha}:.canonical/business.json`]));
  for (const sha of [baseSha, headSha]) {
    const entry = await git(repositoryPath, ['ls-tree', sha, '--', 'src/pricing.mjs']);
    if (!/^100(644|755) blob [a-f0-9]{40}\tsrc\/pricing\.mjs$/.test(entry)) {
      throw new Error('Each revision must contain a regular src/pricing.mjs file');
    }
  }
  const changedFiles = (await git(repositoryPath, ['diff', '--name-only', '-z', baseSha, headSha, '--']))
    .split('\0').filter(Boolean);
  const directory = await mkdtemp(join(tmpdir(), 'canonical-comparison-'));
  const bundlePath = join(directory, 'repository.bundle');
  try {
    // Build a separate bare repository: no changes to the user's refs or checkout,
    // and only history reachable from the two requested commits enters the bundle.
    await git(directory, ['init', '--bare', '--quiet', 'objects.git']);
    const bare = join(directory, 'objects.git');
    await git(bare, ['fetch', '--quiet', '--no-tags', repositoryPath,
      `${baseSha}:refs/heads/baseline`, `${headSha}:refs/heads/candidate`]);
    await git(bare, ['bundle', 'create', bundlePath, '--branches']);
    return {
      baseSha, headSha, repositoryName: basename(repositoryPath), changedFiles, policy, bundlePath,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

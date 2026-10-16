import { readFile } from 'node:fs/promises';
import { RecordId, Surreal, Table } from 'surrealdb';
import { RunSchema, type AnalysisRun, type Graph, type RunStore } from '@canonical/contracts';
import { createSurrealContextStore } from './surreal-context.ts';

export { createSurrealContextStore, getRequirementProvenance } from './surreal-context.ts';

// Official reference: https://surrealdb.com/docs/reference/javascript
export interface SurrealConfig {
  url: string;
  namespace: string;
  database: string;
  username: string;
  password: string;
  authLevel?: 'root' | 'namespace' | 'database';
}

function authentication(config: SurrealConfig) {
  return {
    username: config.username, password: config.password,
    ...(config.authLevel === 'namespace' || config.authLevel === 'database' ? { namespace: config.namespace } : {}),
    ...(config.authLevel === 'database' ? { database: config.database } : {}),
  };
}

// Explicit bootstrap for a fresh local server. Cloud instances normally already
// have a namespace/database; ordinary startup should not require root privileges.
export async function initializeSurreal(config: SurrealConfig) {
  for (const name of [config.namespace, config.database]) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Bootstrap names must contain only letters, digits, and underscores, starting with a letter or underscore.');
  }
  const db = new Surreal();
  try {
    await db.connect(config.url, { authentication: authentication(config) });
    await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${config.namespace}; USE NS ${config.namespace}; DEFINE DATABASE IF NOT EXISTS ${config.database};`);
  } finally { await db.close(); }
}

export async function connectSurreal(config: SurrealConfig): Promise<Surreal> {
  const db = new Surreal();
  try {
    await db.connect(config.url, {
      namespace: config.namespace,
      database: config.database,
      authentication: authentication(config),
    });
    await db.query(await readFile(new URL('./schema.surql', import.meta.url), 'utf8'));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

type RunData = Omit<AnalysisRun, 'graph'>;
type StoredRun = { data: RunData; provenance?: Graph['provenance'] };

export function createSurrealStore(db: Surreal): RunStore {
  return {
    kind: 'surreal',
    context: createSurrealContextStore(db),
    async save(run) {
      const { graph, ...data } = RunSchema.parse(run);
      const bindings: Record<string, unknown> = { record: new RecordId('analysis_run', run.id), data, provenance: graph.provenance, runId: run.id };
      const statements = [
        'BEGIN TRANSACTION;',
        'UPSERT $record CONTENT { data: $data, provenance: $provenance };',
        'DELETE depends_on WHERE runId = $runId;',
        'DELETE concept WHERE runId = $runId;',
      ];
      graph.nodes.forEach((node, i) => {
        bindings[`nodeId${i}`] = new RecordId('concept', `${run.id}:${node.id}`);
        bindings[`node${i}`] = { runId: run.id, data: node };
        statements.push(`CREATE $nodeId${i} CONTENT $node${i};`);
      });
      graph.edges.forEach((edge, i) => {
        bindings[`from${i}`] = new RecordId('concept', `${run.id}:${edge.source}`);
        bindings[`to${i}`] = new RecordId('concept', `${run.id}:${edge.target}`);
        bindings[`edge${i}`] = { runId: run.id, data: edge };
        statements.push(`RELATE $from${i}->depends_on->$to${i} CONTENT $edge${i};`);
      });
      statements.push('COMMIT TRANSACTION;');
      // Bound values only; interpolated names above are generated numeric indices.
      await db.query(statements.join('\n'), bindings);
    },
    async get(id) {
      const [rows, nodes, edges] = await db.query<[StoredRun[], { data: Graph['nodes'][number] }[], { data: Graph['edges'][number] }[]]>(
        'SELECT data, provenance FROM $record; SELECT data FROM concept WHERE runId = $runId; SELECT data FROM depends_on WHERE runId = $runId;',
        { record: new RecordId('analysis_run', id), runId: id },
      );
      if (!rows[0]) return undefined;
      return RunSchema.parse({ ...rows[0].data, graph: { provenance: rows[0].provenance ?? 'declared-fixture', nodes: nodes.map(row => row.data), edges: edges.map(row => row.data) } });
    },
    async list() {
      const [rows] = await db.query<[StoredRun[]]>(
        'SELECT data FROM analysis_run ORDER BY data.createdAt DESC LIMIT 20;',
      );
      const runs = await Promise.all(rows.map(row => this.get(row.data.id)));
      return runs.filter((run): run is AnalysisRun => run !== undefined);
    },
    async close() { await db.close(); },
  };
}

// Small graph query ready for the evidence drawer/impact slice.
export async function getDownstreamConcepts(db: Surreal, runId: string, conceptId: string) {
  const [rows] = await db.query<[Graph['nodes']]>(
    'RETURN array::flatten((SELECT VALUE ->depends_on->concept.data FROM $concept));',
    { concept: new RecordId('concept', `${runId}:${conceptId}`) },
  );
  return rows;
}

// Subscribe on the server, then refetch authoritative state. This is not wired to
// the v0 browser yet: its API client polls pending runs and remains SDK-independent.
export async function watchRuns(db: Surreal, onChange: () => void) {
  const live = await db.live(new Table('analysis_run'));
  live.subscribe(() => onChange());
  return () => live.kill();
}

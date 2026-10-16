import { isRetryableConflict, RecordId, type Surreal } from 'surrealdb';
import {
  ApprovedContextSchema, ContextWorkspaceSchema, type ApprovedContext, type ContextProposal,
  type ContextSource, type ContextStore,
} from '@canonical/contracts';

type ContextSegment = ContextSource['segments'][number];

const conflict = 'CANONICAL_CONTEXT_REVISION_CONFLICT';
const contextEdges = ['contains', 'supported_by', 'adopted_from', 'grounds', 'has_business_context'];
const contextNodes = ['approved_requirement', 'requirement_proposal', 'context_segment', 'context_source'];
const record = (table: string, runId: string, id: string) => new RecordId(table, `${runId}:${id}`);

// https://surrealdb.com/docs/reference/query-language/language-primitives/transactions
// The revision check, document snapshot, and graph replacement share one transaction.
// A conflict returns false; callers can reload and apply their intended operation again.
export function createSurrealContextStore(db: Surreal): ContextStore {
  return {
    async get(runId) {
      const [rows] = await db.query<[{ data: unknown }[]]>(
        'SELECT data FROM $workspace;', { workspace: new RecordId('context_workspace', runId) },
      );
      return rows[0] ? ContextWorkspaceSchema.parse(rows[0].data) : undefined;
    },
    async provenance(runId, requirementId) {
      const rows = await getRequirementProvenance(db, runId, requirementId);
      return rows.filter(row => row.proposals.length === 1 && row.segments.length === 1 && row.sources.length === 1)
        .map(row => ApprovedContextSchema.parse({
          ...row.approval, source: row.sources[0], segment: row.segments[0], quote: row.proposals[0].quote,
        }));
    },
    async save(input, expectedRevision) {
      const workspace = ContextWorkspaceSchema.parse(input);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || workspace.revision !== expectedRevision + 1) {
        throw new Error('Context revision must advance exactly once');
      }
      if ([...workspace.sources, ...workspace.proposals, ...workspace.approvals].some(item => item.runId !== workspace.runId)) {
        throw new Error('Context records must belong to the workspace run');
      }
      const bindings: Record<string, unknown> = {
        workspace: new RecordId('context_workspace', workspace.runId), data: workspace,
        expectedRevision, runId: workspace.runId, analysisRun: new RecordId('analysis_run', workspace.runId),
      };
      const statements = [
        'BEGIN TRANSACTION;',
        'LET $current = SELECT * FROM ONLY $workspace;',
        `IF ($current.data.revision ?? 0) != $expectedRevision { THROW '${conflict}'; };`,
        'UPSERT $workspace CONTENT { runId: $runId, data: $data };',
        ...contextEdges.map(table => `DELETE ${table} WHERE runId = $runId;`),
        ...contextNodes.map(table => `DELETE ${table} WHERE runId = $runId;`),
      ];
      let bindingIndex = 0;
      const bind = (value: unknown) => {
        const name = `contextValue${bindingIndex++}`;
        bindings[name] = value;
        return `$${name}`;
      };
      const node = (id: RecordId, data: unknown) => statements.push(
        `CREATE ${bind(id)} CONTENT ${bind({ runId: workspace.runId, data })};`,
      );
      const edge = (from: RecordId, table: string, to: RecordId) => statements.push(
        `RELATE ${bind(from)}->${table}->${bind(to)} CONTENT { runId: $runId };`,
      );
      const sourceIds = new Set<string>();
      const segmentIds = new Set<string>();
      for (const source of workspace.sources) {
        if (sourceIds.has(source.id)) throw new Error('Context source IDs must be unique');
        sourceIds.add(source.id);
        const sourceRecord = record('context_source', workspace.runId, source.id);
        // Raw source text stays in the immutable workspace snapshot. Graph traversal
        // exposes source metadata and only the referenced verbatim segments.
        const { text: _text, segments, ...metadata } = source;
        node(sourceRecord, metadata);
        for (const segment of segments) {
          const key = JSON.stringify([source.id, segment.id]);
          if (segmentIds.has(key)) throw new Error('Context segment IDs must be unique within a source');
          segmentIds.add(key);
          const segmentRecord = record('context_segment', workspace.runId, key);
          node(segmentRecord, segment);
          edge(sourceRecord, 'contains', segmentRecord);
        }
      }
      const proposals = new Map<string, ContextProposal>();
      for (const proposal of workspace.proposals) {
        if (proposals.has(proposal.id)) throw new Error('Context proposal IDs must be unique');
        proposals.set(proposal.id, proposal);
        const key = JSON.stringify([proposal.sourceId, proposal.segmentId]);
        if (!segmentIds.has(key)) throw new Error('Context proposal must reference an existing source segment');
        const proposalRecord = record('requirement_proposal', workspace.runId, proposal.id);
        node(proposalRecord, proposal);
        edge(proposalRecord, 'supported_by', record('context_segment', workspace.runId, key));
      }
      const approvalIds = new Set<string>();
      for (const approval of workspace.approvals) {
        if (approvalIds.has(approval.id)) throw new Error('Context approval IDs must be unique');
        approvalIds.add(approval.id);
        if (proposals.get(approval.proposalId)?.status !== 'accepted') {
          throw new Error('Context approval must reference an accepted proposal');
        }
        const approvalRecord = record('approved_requirement', workspace.runId, approval.id);
        node(approvalRecord, approval);
        edge(approvalRecord, 'adopted_from', record('requirement_proposal', workspace.runId, approval.proposalId));
        edge(new RecordId('analysis_run', workspace.runId), 'has_business_context', approvalRecord);
        for (const conceptId of new Set(approval.conceptIds)) {
          edge(approvalRecord, 'grounds', record('concept', workspace.runId, conceptId));
        }
      }
      statements.push('COMMIT TRANSACTION;');
      try {
        await db.query(statements.join('\n'), bindings);
        return true;
      } catch (error) {
        if (isRetryableConflict(error) || (error instanceof Error && error.message.includes(conflict))) return false;
        throw error;
      }
    },
  };
}

export interface RequirementProvenance {
  approval: ApprovedContext;
  proposals: ContextProposal[];
  segments: ContextSegment[];
  sources: Array<Omit<ContextSource, 'text' | 'segments'>>;
}

// These paths traverse native relations; they do not reconstruct provenance from
// the embedded approval document. Removing an edge removes that path's evidence.
export async function getRequirementProvenance(db: Surreal, runId: string, requirementId: string) {
  const [rows] = await db.query<[RequirementProvenance[]]>(`
    SELECT data AS approval,
      array::flatten(->adopted_from->requirement_proposal.data) AS proposals,
      array::flatten(->adopted_from->requirement_proposal->supported_by->context_segment.data) AS segments,
      array::flatten(->adopted_from->requirement_proposal->supported_by->context_segment<-contains<-context_source.data) AS sources
    FROM approved_requirement WHERE runId = $runId AND data.requirementId = $requirementId;
  `, { runId, requirementId });
  return rows;
}

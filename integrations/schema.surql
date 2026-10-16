-- v0 keeps run metadata/results as a document and the business map as a native graph.
-- Snapshot-scoped symbols, requirements, and evidence relations belong to the commit slice.
DEFINE TABLE IF NOT EXISTS analysis_run SCHEMALESS;
DEFINE TABLE IF NOT EXISTS concept SCHEMALESS;
DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN concept OUT concept SCHEMALESS;
DEFINE INDEX IF NOT EXISTS concept_run ON concept FIELDS runId;
DEFINE INDEX IF NOT EXISTS relationship_run ON depends_on FIELDS runId;

-- Context changes are independent of executed run evidence and its concept map.
DEFINE TABLE IF NOT EXISTS context_workspace SCHEMALESS;
DEFINE TABLE IF NOT EXISTS context_source SCHEMALESS;
DEFINE TABLE IF NOT EXISTS context_segment SCHEMALESS;
DEFINE TABLE IF NOT EXISTS requirement_proposal SCHEMALESS;
DEFINE TABLE IF NOT EXISTS approved_requirement SCHEMALESS;
DEFINE TABLE IF NOT EXISTS contains TYPE RELATION IN context_source OUT context_segment SCHEMALESS;
DEFINE TABLE IF NOT EXISTS supported_by TYPE RELATION IN requirement_proposal OUT context_segment SCHEMALESS;
DEFINE TABLE IF NOT EXISTS adopted_from TYPE RELATION IN approved_requirement OUT requirement_proposal SCHEMALESS;
DEFINE TABLE IF NOT EXISTS grounds TYPE RELATION IN approved_requirement OUT concept SCHEMALESS;
DEFINE TABLE IF NOT EXISTS has_business_context TYPE RELATION IN analysis_run OUT approved_requirement SCHEMALESS;
DEFINE INDEX IF NOT EXISTS context_source_run ON context_source FIELDS runId;
DEFINE INDEX IF NOT EXISTS context_segment_run ON context_segment FIELDS runId;
DEFINE INDEX IF NOT EXISTS proposal_run ON requirement_proposal FIELDS runId;
DEFINE INDEX IF NOT EXISTS approval_requirement ON approved_requirement FIELDS runId, data.requirementId;
DEFINE INDEX IF NOT EXISTS contains_run ON contains FIELDS runId;
DEFINE INDEX IF NOT EXISTS supported_by_run ON supported_by FIELDS runId;
DEFINE INDEX IF NOT EXISTS adopted_from_run ON adopted_from FIELDS runId;
DEFINE INDEX IF NOT EXISTS grounds_run ON grounds FIELDS runId;
DEFINE INDEX IF NOT EXISTS business_context_run ON has_business_context FIELDS runId;

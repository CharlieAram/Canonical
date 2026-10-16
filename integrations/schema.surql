-- v0 keeps run metadata/results as a document and the business map as a native graph.
-- Snapshot-scoped symbols, requirements, and evidence relations belong to the commit slice.
DEFINE TABLE IF NOT EXISTS analysis_run SCHEMALESS;
DEFINE TABLE IF NOT EXISTS concept SCHEMALESS;
DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN concept OUT concept SCHEMALESS;
DEFINE INDEX IF NOT EXISTS concept_run ON concept FIELDS runId;
DEFINE INDEX IF NOT EXISTS relationship_run ON depends_on FIELDS runId;

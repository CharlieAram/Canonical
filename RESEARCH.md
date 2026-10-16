# Canonical research: Daytona, SurrealDB, and reusable tools

Researched October 16, 2026 for the idea in [README.md](README.md). The implementation recommendation is scoped to separate UI/backend ownership and vertical slices in [PLAN.md](PLAN.md).

This is a documentation and source review. No Daytona account operations, database queries, or third-party packages were executed for this research. Capability statements below come from primary documentation or project repositories; the build priorities and tradeoffs are recommendations.

## Recommendation

Use Daytona as the execution environment for exact before/after commits, business checks, benchmark workloads, and interactive previews. Use SurrealDB as the persistent graph connecting business concepts, implementations, requirements, revisions, and execution evidence, with live updates for the review UI.

The combination supports a stronger claim than generated repository documentation: **a business explanation that can be inspected and tested**. The central technical challenge is preserving the distinction between declared intent, inferred implementation, and measured behavior.

Maximizing sponsor use for the initial slices means making a few capabilities essential to the demo. Graph traversal plus live evidence is a stronger SurrealDB integration than merely storing a JSON report; exact-revision execution plus previews is a stronger Daytona integration than using it only to host the dashboard.

## Daytona: what is useful here

### Current entry points and source status

Use the current [`daytona/clients`](https://github.com/daytona/clients) repository and `@daytona/sdk`. Its README identifies the SDKs/API clients as Apache-2.0 and the CLI separately as AGPL-3.0. Current runnable examples live in [`daytona/guides`](https://github.com/daytona/guides).

The older [`daytonaio/daytona`](https://github.com/daytonaio/daytona) repository is archived. Its README says core development moved to a private codebase in June 2026. Do not start by self-hosting that old repository or assume its code describes the current hosted API. This does not prevent using the maintained SDK and sponsor service.

### Execution model

Daytona provides isolated sandboxes with filesystem, process, and network capabilities. Its process API supports shell commands and background sessions; sessions are appropriate for a web server that must outlive an individual command call. Use commands for the repository's actual build/test entry points. [Sandboxes](https://www.daytona.io/docs/en/sandboxes/), [process and code execution](https://www.daytona.io/docs/en/process-code-execution/)

For Canonical, maintain a small explicit lifecycle:

`create → checkout → install → validate → benchmark → preview → collect artifacts → cleanup`.

Record stage errors rather than treating a sandbox timeout as a business failure. Limit the first implementation to two fixed evaluation jobs; it does not need autonomous scheduling.

The Git API includes cloning, exact-commit checkout, and authenticated operations. Clone the owned demo repo and verify `git rev-parse HEAD` before accepting any evidence. Use full SHAs and lockfiles. A mutable branch name alone is insufficient provenance. [Git operations](https://www.daytona.io/docs/en/git-operations/)

### Snapshots, warm pools, and reproducibility

Snapshots can provide a prepared runtime and dependencies. Current documentation distinguishes container filesystem captures from VM captures that can include memory. There are also image-based preparation paths. For this project, build one reusable container starting point; do not depend on VM memory cloning or live-process restoration. [Snapshots](https://www.daytona.io/docs/en/snapshots/)

The page has some inconsistent wording about which sandbox classes support capture-from-sandbox. Resolve that against the installed SDK/account before using that feature. Image-based preparation avoids making it part of the demo's critical path.

Snapshot reuse reduces setup work; it does not establish identical CPU scheduling, eliminate measurement noise, or reproduce external services. Pin the runtime, dependency lockfile, fixture, harness, resources, and region separately. Log those fields with the benchmark.

Warm pools provide pre-created running sandboxes, but the docs say they require organization enablement. Matching also constrains snapshot, region, resources, user, environment variables, volumes, and secrets. Do not rely on them for a initial build; simply create the two demo sandboxes before presentation. [Warm pools](https://www.daytona.io/docs/en/warm-pools/)

### Daytona preview and evidence

Use an expiring **signed preview URL** for each app port. It can open in a browser without custom headers. Current docs distinguish this from the standard preview token, which is sandbox-wide. Keep the standard token on the backend. Specify the signed link lifetime explicitly—the documented default is only 60 seconds—and refresh before presenting. [Preview URLs](https://www.daytona.io/docs/en/preview/)

The documented TypeScript method is `sandbox.getSignedPreviewUrl(port, expiresInSeconds)`. Treat exact method names as SDK-version-sensitive and verify them in the initial smoke test. Start with a new-tab preview; iframe behavior may also depend on the application and browser.

Stream logs into progress states while tests run. Preserve structured JSON reports and copy artifacts out before deleting the sandbox. A preview or signed download URL is a temporary access mechanism, not durable storage. [Log streaming](https://www.daytona.io/docs/en/log-streaming/), [sandbox SDK reference](https://www.daytona.io/docs/en/typescript-sdk/sandbox/)

### Browser interaction and computer use

Daytona documents desktop/computer-use operations, including screen interaction. That could support an agent visually testing arbitrary applications later. For this demo's known page, Playwright is the more direct way to run the same scenario twice. Computer-use autonomy introduces extra model calls, selector/vision uncertainty, and desktop setup without strengthening the business assertion. [Computer use](https://www.daytona.io/docs/en/computer-use/)

A practical ladder is:

1. P0: deterministic API check plus live app previews.
2. P1: one Playwright test and screenshots.
3. Later: agent-generated exploratory browser tests or desktop recordings.

Playwright Trace Viewer can inspect actions, page state, network activity, and errors. If time permits, retain a trace of the failing scenario as secondary evidence. Pin the Playwright package and browser image to matching versions; official Docker docs call out browser-executable failures when they differ. [Trace Viewer](https://playwright.dev/docs/trace-viewer-intro), [Docker setup](https://playwright.dev/docs/docker)

### Useful example to adapt

Daytona's [Vercel AI SDK benchmark example](https://github.com/daytona/guides/tree/main/typescript/vercel-ai-sdk/multi-language-benchmark-agent) is unusually close to this project's execution needs. Its source demonstrates command execution, file upload/download, progress streaming, and extracting real benchmark artifacts. The example is Apache-2.0.

Reuse the small SDK interaction patterns. Replace its open-ended agent loop with the fixed Canonical harness. Its sample dependency versions are not a guarantee of compatibility with today's SDK; pin and test the actual chosen versions. There is no need to adopt its model, multi-language task, plotting stack, or 25-step loop.

### Operational choices

Daytona offers outbound network controls and lifecycle/resource limits. For the demo, keep the target repo and upstream fixture controlled; do not provide target code with the orchestrator's database credentials. Fetch dependencies before restricting network access if restrictions are enabled. Confirm the account can run two intended sandboxes before polishing the UI. [Network limits](https://www.daytona.io/docs/en/network-limits/), [platform limits](https://www.daytona.io/docs/en/limits/)

Shared volumes are useful for caches across larger workloads, but shared mutable application state would spoil the before/after comparison. Skip shared volumes for this build. Independent seeded state is simpler. [Volumes](https://www.daytona.io/docs/en/volumes/)

## SurrealDB: what is useful here

### Graph and documents together

`RELATE` creates native edge records that can carry their own properties, and traversal can follow those relations in either direction. This fits a provenance chain: symbol implements concept; requirement constrains concept; evidence validates requirement. Store source SHA, extraction method, and source location on the relevant records/edges. [RELATE reference](https://surrealdb.com/docs/reference/query-language/statements/relate)

Use these graph queries in the actual UI:

- Clicking a changed symbol finds its mapped business concepts.
- Clicking a concept finds the approved requirements and implementing symbols.
- Clicking a failed requirement retrieves the exact test result and affected concepts.
- Expanding an affected concept follows a bounded dependency neighborhood.

A report JSON blob alone would discard most of the database's value. Conversely, storing every AST node is unnecessary for a ten-node business presentation. Keep detailed syntax facts in bounded source records and surface only the business layer.

Use transactions to publish a coherent graph snapshot and its ready marker. Incremental test results can arrive afterward as separate committed records. Do not keep a transaction open while waiting on a model or sandbox. [Transactions / BEGIN](https://surrealdb.com/docs/reference/query-language/statements/begin)

### Commit history is an application concern

Use immutable snapshot-scoped concept and symbol records with stable logical keys. Physical IDs differ by revision, making before/after state unambiguous; the logical key makes diffing possible. Persist source SHA, policy hash, harness hash, and analyzer version.

SurrealDB also documents storage time-travel reads through `VERSION` when a supporting engine has versioning enabled. That is database write history, not automatically Git history. It does not solve concept identity or branch semantics. Avoid coupling the demo to engine-specific history features. [SELECT and VERSION](https://surrealdb.com/docs/reference/query-language/statements/select)

The first implementation should materialize both small snapshots. Differential storage can wait until size makes it useful. A history selector then reads real stored snapshots rather than reconstructing an old report from current nodes.

### SurrealDB live updates

`LIVE SELECT` watches a table, including relation tables. It does not subscribe to an arbitrary multi-hop graph query. Watch `run` and `evidence`, then refetch the affected graph view. Community live queries are local to the subscription's node; the docs reserve distributed cluster-wide live queries for Enterprise. Choose a deployment that matches this requirement. [LIVE SELECT reference](https://surrealdb.com/docs/reference/query-language/statements/live-select)

Notifications follow committed writes, but cross-writer ordering is not a strict global ordering guarantee. Use run IDs, record IDs, and sequence numbers; reconstruct the UI from persisted state after reconnect. Keep filters stable on run ID, rather than statuses that a record can leave without a matching notification. [Live-query behavior](https://surrealdb.com/docs/learn/querying/real-time/live-queries)

The JavaScript SDK requires a WebSocket-capable connection for live subscriptions. Its current managed `.live()` API can restart subscriptions after reconnect; raw `LIVE SELECT` subscriptions are unmanaged and need explicit restoration. The backend can bridge these events to the browser over SSE. [JavaScript live queries](https://surrealdb.com/docs/reference/javascript/concepts/live-queries)

A smoke test should create a result, observe it in the UI, interrupt the connection, write another result, reconnect, and verify the refreshed report. Do this before adding animated graph transitions.

### Vector and hybrid search: the best stretch feature

Embeddings are useful for mapping a plain-language question to a concept or requirement. They are not the authority for whether a commit violates it. After retrieving candidate records, traverse the stored relations and answer from evidence for the selected revision.

SurrealDB supports HNSW vector indexing and exact/brute-force search. For fewer than 100 business records, exact search is sufficient; an HNSW index can demonstrate the capability but is not a scaling necessity. Match embedding dimensions and distance metric, and use `EXPLAIN` to verify index usage if claiming indexed retrieval. [Vector indexes](https://surrealdb.com/docs/learn/data-models/vector-search/vector-indexes)

Hybrid retrieval can combine exact terms such as a requirement ID with semantically related language. The database's `search::rrf` fuses already ranked result lists. Scope candidates to the selected repo/revision before fusion, and verify function signatures against the installed release; older examples differ. [Search function reference](https://surrealdb.com/docs/reference/query-language/functions/database-functions/search), [hybrid-search walkthrough](https://surrealdb.com/learn/ai/hybrid-search-reranking)

If adding this feature, constrain it to one question flow:

`question → embedding → top matching requirement/concept records → graph neighbors → cited explanation`.

Do not add a second vector database, general GraphRAG framework, or unconstrained text-to-SurrealQL agent. A fixed retrieval function and one model call are enough. Show “insufficient evidence” when the selected run cannot answer the question.

### Agent memory and SDK compatibility

SurrealDB now documents an Agent Memory product with hybrid, vector, keyword, and graph retrieval modes. It is worth studying for later context retrieval, but is a separate service/API surface from the database primitives needed here. Do not assume those endpoints appear merely by starting the database. The initial build should use direct records and queries. [Agent Memory retrieval](https://surrealdb.com/docs/agent-memory/retrieve/hybrid-search)

At research time, the JavaScript documentation reports SDK `2.1.1` and database `3.3.4`, with SDK support for database versions `2.0.0` onward. Use a tested pinned pair. The v2 SDK redesigned live-query APIs, and SurrealDB 3.x changed some query syntax; old tutorials can therefore be misleading. [JavaScript SDK](https://surrealdb.com/docs/reference/javascript), [SDK 2.0 changes](https://surrealdb.com/blog/introducing-javascript-sdk-2-0), [2.x-to-3.x migration](https://surrealdb.com/docs/build/migrating/from-old-surrealdb-versions/2x-to-3x)

Implementation verification found the published server release `v3.3.0`, while the `v3.3.4` release tag was unavailable. The skeleton therefore pins server `3.3.0` with SDK `2.1.1`; documentation version labels alone are not evidence that a release artifact is available. [Published server release](https://github.com/surrealdb/surrealdb/releases/tag/v3.3.0)

The server's current repository license is Business Source License 1.1, so describe it accurately as source-available rather than grouping it with MIT libraries. The plan uses the sponsor database as an application dependency. [Server license](https://github.com/surrealdb/surrealdb/blob/main/LICENSE)

## Existing projects: adapt narrowly or use as references

| Project | Verified capability / status | Relevance to Canonical | Decision for the first slices |
|---|---|---|---|
| [Daytona benchmark guide](https://github.com/daytona/guides/tree/main/typescript/vercel-ai-sdk/multi-language-benchmark-agent) | Apache-2.0 example with execution tools and artifact downloads | Closest reusable execution pattern | Adapt small SDK wrappers; use a deterministic harness |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Code graph, impact tools, MCP, generated agent context; current license is PolyForm Noncommercial | Strong reference for change impact and context feedback | Study interaction patterns; do not make a wholesale fork the critical path |
| [CodeGraph by Cirilcetra](https://github.com/Cirilcetra/codegraph) | MIT; JS/TS/Python Tree-sitter indexing, Kuzu graph, MCP tools | Potential extraction reference or later adapter | Native parser/database setup and data-model conversion cost exceed the narrow demo's needs |
| [FalkorDB CodeGraph](https://github.com/FalkorDB/code-graph) | MIT; code graph app with Python backend, React UI, FalkorDB/GraphRAG integration | Useful UI and graph-model reference | Swapping its database and application model is too much work here |
| [DeepWiki Open](https://github.com/AsyncFuncAI/deepwiki-open) | MIT; repository documentation, diagrams, and guided code exploration | Reference for readable repository explanations | Study summarization UX; Canonical needs execution and commit-specific requirement evidence |

GitNexus is not a permissively licensed component: its [license file](https://github.com/abhigyanpatwari/GitNexus/blob/main/LICENSE) explicitly identifies PolyForm Noncommercial. Treat it as a source-available reference in this evaluation, not as interchangeable with MIT tooling.

The older [`FalkorDB/code-graph-backend`](https://github.com/FalkorDB/code-graph-backend) says it has been merged into the main CodeGraph repository. Use the maintained project when evaluating it.

Across these projects, the reusable idea is a structural code graph plus retrieval and agent context. Canonical's proposed contribution is the business requirement overlay, revision comparison, and executed counterexample. This is a positioning judgment based on the reviewed project descriptions, not an exhaustive claim that no competing project has similar features.

## Libraries and tools ranked by implementation value

| Tool | License reported by project | Use | Priority / tradeoff |
|---|---|---|---|
| [ts-morph](https://github.com/dsherret/ts-morph) | MIT | Extract TS functions, imports, ranges, and resolvable references | P0; more direct for this TS fixture than integrating multiple grammars |
| [React Flow](https://github.com/xyflow/xyflow) | MIT | Business nodes, labeled edges, selectable evidence | P0; use fixed positions initially |
| [Zod](https://github.com/colinhacks/zod) | MIT | Shared contracts, model output and evidence validation | P0; prevent invalid IDs or result shapes entering the graph |
| [Tinybench](https://github.com/tinylibs/tinybench) | MIT | Timing statistics for a function-level benchmark | Optional; a small request timer with saved raw samples may be simpler for the chosen API scenario |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Browser scenario, screenshots, trace evidence | P1; API checks and manual previews come first |
| [Vercel AI SDK](https://github.com/vercel/ai) | Apache-2.0 | Structured model calls and provider abstraction | Use if familiar; a provider's existing SDK is also sufficient |
| [Dagre](https://github.com/dagrejs/dagre) | MIT | Directed graph layout | Optional; low effort when fixed positions stop being sufficient |
| [ELK.js](https://github.com/kieler/elkjs) | EPL-2.0 | Richer layered graph layout | Later; unnecessary complexity for ten nodes |
| [fast-check](https://github.com/dubzzz/fast-check) | MIT | Property-based account/SKU combinations and shrinking failures | Later; the fixed two-account counterexample is faster to build and explain |
| [Tree-sitter](https://github.com/tree-sitter/tree-sitter) | MIT | Multi-language syntax extraction | Later; syntax parsing still needs separate reference and business-meaning resolution |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | See package/repository license | Expose approved graph context to coding agents | Later; the file export already demonstrates feedback |

License labels were checked in repository metadata or license files during this review. Pin actual package versions and preserve their notices when reusing code. GitHub availability and stars are not a substitute for testing a dependency in the selected runtime.

Avoid adding an agent framework merely to orchestrate a fixed sequence. The first runner needs a state machine, bounded model calls, and a clear result contract. It does not need multiple autonomous agents, a queue product, a workflow engine, or a separate tracing platform.

## Decisions worth making before coding

| Decision | Recommended choice | Reason |
|---|---|---|
| What repo? | Tiny in-repo TypeScript quote service | Every business concept and failure is explainable on stage |
| Where do requirements come from? | Approved JSON policy and small glossary | Avoid deriving the oracle from the same code being judged |
| How is meaning inferred? | AST facts plus bounded structured LLM mapping | Source grounding without building a universal analyzer |
| What does Daytona prove? | Actual behavior of pinned revisions under one reproducible workload | Directly supports the product claim |
| What does SurrealDB do? | Native graph, evidence persistence, live results | Visible sponsor capabilities on the critical path |
| How does CI trigger it? | One owned-branch Actions workflow invoking a CLI | Avoid OAuth, webhook hosting, and app installation |
| How does context get back? | Explicit local context export plus CI artifact | Complete the README's feedback loop cheaply |
| What gets added if ahead? | One browser replay, then one grounded semantic question | Both deepen the same story |
| What gets cut? | Arbitrary repo support, auto-fix, 3D graph, multi-agent orchestration | Too much integration cost for the first vertical slices |

## Initial integration spike

Verify the foundation before extending the sponsor slice:

1. Daytona SDK creates a sandbox and executes a command; record the installed SDK version.
2. The chosen sandbox runtime can run the small service and return JSON evidence.
3. SurrealDB accepts a relation and returns a reverse traversal result.
4. A WebSocket live subscription observes a newly written result.
5. A signed app preview opens in a normal browser.

These checks resolve the main account/version uncertainties. After they pass, freeze the stack and implement the vertical slice. Extend one complete evidence path before introducing additional frameworks.

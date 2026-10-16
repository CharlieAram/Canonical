# Development handoff

The review loop now supports the fixture and real commits: execute checks → display business policy and evidence → export context. The repository path runs through the CLI and Daytona; import its JSON report into the dashboard. Keep UI and backend independently runnable while extending this loop.

## UI workspace

Work in `apps/ui`. Start with `npm run dev:ui:fixture` to develop without the API. The shared fixture lives in `packages/demo`; make presentation changes in the UI and coordinate changes to shared data with the backend owner.

Use `npm run dev` when validating actual execution. The browser accesses `/api` through the Vite proxy. Keep service credentials and SDK imports outside the UI.

Preserve the distinction between declared business intent, execution results, and later code inference. The fixture-mode benchmark values are sample data; the local and Daytona runners return measured values. A run marked `completed` can still have failed checks. Show pending and execution-error states separately from pass/fail.

## Backend workspace

Work in `apps/api`, `packages/runner`, and the top-level `integrations` directory. The runner owns evaluation and context generation; adapters own service-specific calls. `RunStore` in the shared contract is the persistence boundary.

Use `npm run dev:api` for the API, `npm run analyze -- --execution local` for the complete CLI path, and `npm run check` before handing off. The CLI emits status 1 for the deliberately failing candidate after writing artifacts under `.canonical/output`; status 2 means an execution error.

The local runner supports only the trusted in-repository fixture. Actual repository execution uses `prepareRepositoryComparison` in `packages/runner/src/repository.ts` and `evaluateRepositoryWithDaytona` in `integrations/daytona.ts`. The CLI accepts `--execution daytona --repo PATH --base REF --head REF`; see [real CI](REAL_CI.md) for the testbed commands. Git preparation reads committed objects without modifying the developer's checkout. The baseline commit owns `.canonical/business.json`; Canonical owns `checks/repository-pricing.mjs`.

CLI outputs are `report.json`, a second JSON file named by the run ID, `context.md`, and `report.md` for CI summaries. The CLI and API have separate memory stores. The UI's **Import report JSON** action brings a terminal CLI report into the API; it does not rerun its checks. A shared configured SurrealDB can persist both processes' reports, but the browser may need a reload to discover a newly written run.

## HTTP contract

`packages/contracts/src/index.ts` is the source of truth. It contains Zod schemas and inferred TypeScript types, with no SDK dependency. Coordinate changes to this file so the UI fixture, API, and runner continue to agree.

| Request | Response / purpose |
|---|---|
| `GET /api/health` | Storage mode and available execution modes |
| `GET /api/runs` | `{ "runs": [...] }` with recent runs |
| `POST /api/runs` | Start a run; HTTP 202 with the queued run |
| `POST /api/runs/import` | Import a schema-valid completed/error report; HTTP 201 with its original ID |
| `GET /api/runs/:id` | Current run, graph, requirements, and results |
| `GET /api/runs/:id/context` | Generated context as text |

Start-run body:

```json
{ "execution": "local", "scenario": "pricing-cache" }
```

`execution` can be `daytona` when the backend has a Daytona key. This start endpoint runs the fixture; use the CLI for Git comparison. Poll pending runs until `completed` or `error`. Each run records its execution mode, timestamps, source, graph provenance, approved requirements, and baseline/candidate evaluations.

`source.kind` is `fixture` or `git`. Git sources carry full `baseSha`/`headSha`, friendly ref labels, `changedFiles`, and `policyPath`. Each Git evaluation includes its verified `commitSha`; the runner rejects missing or mismatched revision evidence. Graph provenance is `declared-fixture` or `declared-policy`. Approved policy is loaded from the baseline, not generated from candidate behavior.

The API accepts one analysis at a time and returns 409 if another is running. Invalid start bodies return 400, unavailable Daytona configuration returns 503, and unknown run IDs return 404. The context endpoint downloads `canonical-context.md` as Markdown.

Report imports accept at most 1MiB, require a terminal status, and return 409 for an existing ID. They cannot replace an active analysis. Malformed reports return 400; oversized requests return 413. Imports validate report structure but do not independently replay or attest external execution. Keep the development API on its default loopback binding; authenticated hosted ingestion is a later slice.

For hosted SurrealDB, configure `SURREAL_URL` with the database connection endpoint, plus `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, `SURREAL_USERNAME`, `SURREAL_PASSWORD`, and `SURREAL_AUTH_LEVEL` (`root`, `namespace`, or `database`). The current adapter uses username/password authentication. A SurrealDB MCP connection is separate and does not supply the application connection. [Integration setup](../integrations/README.md).

## Next vertical slices

| Slice | Backend outcome | UI outcome | Acceptance check |
|---|---|---|---|
| Local v0 | Execute trusted fixture and export context | Start, inspect, download | Baseline passes; candidate returns the wrong account price; export preserves the rule and evidence |
| Sponsor integration | Daytona execution plus SurrealDB graph persistence | Show execution provenance and persistent history | Same scenario completes through both services; reload recovers evidence |
| Actual Git comparison — implemented | Check out and verify exact revisions; retain trusted checks | Import report, display revision evidence | Every result refers to its verified source revision |
| Inferred business graph | Extract source facts and validate model mappings | Distinguish declared, inferred, and executed information | Every code claim has a valid source reference |
| Continuous review — workflow added | CI invocation and artifact export; hosted run verification remains explicit | Import CI report; automatic delivery later | A commit yields downloadable evidence; then add persisted delivery and reconnect recovery |

The [meeting-context scope](MEETING_CONTEXT.md) proposes transcript import, reviewed requirement proposals, and an optional Fathom adapter. Keep provider setup separate from the initial text-import flow. The UI can develop the proposal/source drawer while backend work adds source normalization and approval lineage.

Signed previews, browser evidence, and grounded questions can extend the same evidence path after the core slices work. [PLAN.md](../PLAN.md) describes the intended product in detail; it is a roadmap, not a claim that every feature is implemented.

## Conversation review slice

The shared conversation contracts are in `packages/contracts/src/context.ts`.
`BusinessContextPanel` and the existing evidence panel support transcript import,
manual quote-to-rule proposals, review, and approved citations. Backend operations
live in `packages/runner/src/business-context.ts`; HTTP orchestration lives in
`apps/api/src/context-routes.ts`. Storage implementations are the memory context
store and `integrations/surreal-context.ts`. See [the user/API guide](TRANSCRIPT_CONTEXT.md).

This slice preserves the selected run's executed policy. Reviewed conversation
context is added afterward, scoped to that run, and exported separately from the
original check evidence. The next policy-authoring slice can create and commit a
new approved policy before execution instead of claiming retroactive provenance.

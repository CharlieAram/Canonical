# Development handoff

The first vertical slice is a reviewable loop: start an analysis → execute the fixture → display the business graph and evidence → export context. Grow that loop in small slices, keeping the UI and backend independently runnable.

## UI workspace

Work in `apps/ui`. Start with `npm run dev:ui:fixture` to develop without the API. The shared fixture lives in `packages/demo`; make presentation changes in the UI and coordinate changes to shared data with the backend owner.

Use `npm run dev` when validating actual execution. The browser accesses `/api` through the Vite proxy. Keep service credentials and SDK imports outside the UI.

Preserve the distinction between declared business intent, execution results, and later code inference. The fixture-mode benchmark values are sample data; the local and Daytona runners return measured values. A run marked `completed` can still have failed checks. Show pending and execution-error states separately from pass/fail.

## Backend workspace

Work in `apps/api`, `packages/runner`, and the top-level `integrations` directory. The runner owns evaluation and context generation; adapters own service-specific calls. `RunStore` in the shared contract is the persistence boundary.

Use `npm run dev:api` for the API, `npm run analyze -- --execution local` for the complete CLI path, and `npm run check` before handing off. The CLI emits status 1 for the deliberately failing candidate after writing artifacts under `.canonical/output`; status 2 means an execution error.

The local runner supports only the trusted in-repository fixture. Add actual repository execution through Daytona, alongside verified source metadata, when building the Git slice.

## HTTP contract

`packages/contracts/src/index.ts` is the source of truth. It contains Zod schemas and inferred TypeScript types, with no SDK dependency. Coordinate changes to this file so the UI fixture, API, and runner continue to agree.

| Request | Response / purpose |
|---|---|
| `GET /api/health` | Storage mode and available execution modes |
| `GET /api/runs` | `{ "runs": [...] }` with recent runs |
| `POST /api/runs` | Start a run; HTTP 202 with the queued run |
| `GET /api/runs/:id` | Current run, graph, requirements, and results |
| `GET /api/runs/:id/context` | Generated context as text |

Start-run body:

```json
{ "execution": "local", "scenario": "pricing-cache" }
```

`execution` can be `daytona` when the backend has a Daytona key. Poll pending runs until `completed` or `error`. Each run records its execution mode, timestamps, fixture source, graph provenance, approved requirements, and baseline/candidate evaluations. The current source labels are fixture variants, not Git SHAs.

The API accepts one analysis at a time and returns 409 if another is running. Invalid start bodies return 400, unavailable Daytona configuration returns 503, and unknown run IDs return 404. The context endpoint downloads `canonical-context.md` as Markdown.

## Next vertical slices

| Slice | Backend outcome | UI outcome | Acceptance check |
|---|---|---|---|
| Local v0 | Execute trusted fixture and export context | Start, inspect, download | Baseline passes; candidate returns the wrong account price; export preserves the rule and evidence |
| Sponsor integration | Daytona execution plus SurrealDB graph persistence | Show execution provenance and persistent history | Same scenario completes through both services; reload recovers evidence |
| Actual Git comparison | Check out and verify exact revisions; retain trusted checks | Revision selection and source links | Every result refers to its verified source revision |
| Inferred business graph | Extract source facts and validate model mappings | Distinguish declared, inferred, and executed information | Every code claim has a valid source reference |
| Continuous review | CI invocation and live notifications with recovery | Progress, history, reconnect states | A commit yields a persisted report; reconnect restores authoritative state |

Signed previews, browser evidence, and grounded questions can extend the same evidence path after the core slices work. [PLAN.md](../PLAN.md) describes the intended product in detail; it is a roadmap, not a claim that every feature is implemented.

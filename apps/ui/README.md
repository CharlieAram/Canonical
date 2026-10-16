# UI handoff

From the repository root:

```sh
npm install
npm run dev:ui:fixture
```

Open http://127.0.0.1:5173. Fixture mode is independent of the API, Daytona, and SurrealDB. Its banner explicitly labels every result synthetic. `New fixture` creates another illustrative run; it executes no code.

Use `npm run dev` from the root for the real local execution loop. Vite proxies `/api` to `http://127.0.0.1:3001`; select Daytona once the API reports it available. All secrets stay on the server. The normal UI never silently falls back to synthetic data.

The page has two sections, reached from the left rail. A minimal fade-and-lift animation reveals each section as you scroll; it is disabled under reduced motion.

**Objects** renders `run.review.objects` as an object relation graph. Objects your agent added, changed or removed are highlighted. Each change has an efficiency evaluation that combines structural facts with the run's measured benchmark.

**Logic graph** lists every logic flow in `run.review.logic`, grouped by entry node. Selecting one renders it as an algorithmic flowchart: rounded start and end steps, diamonds for decisions, Yes and No paths. Changed steps are highlighted, and each one has its own efficiency evaluation.

Both sections end with recommendations that have **Confirm**, **Deny** and **Auto** controls, plus an **Auto review** box with a **Run automatically** switch. Auto review confirms only suggestions backed by a failed executable check. Suggestions are deterministic rules in `src/lib/review.ts` over extracted facts and failed checks (for example, a cache key that omits inputs the caller receives). They are labelled "backed by a failed check" or "rule-based, not verified". Decisions are stored per viewer in `localStorage`; nothing is sent to the agent or the backend.

Fixture mode attaches `src/lib/review-fixture.json`, generated once with the real extractor in `packages/runner/src/extraction.ts` from the sources in `tests/extraction.test.ts`.

Removed from the UI (the backend and API client are untouched): run history, report import, agent-context download, requirements and performance, business-context panel, code diff and review pipeline.

## Replace these components freely

- `src/App.tsx`: layout, section rail, run selection, live updates and run actions.
- `src/components/ObjectsSection.tsx`: object relation graph, proposed changes, recommendations.
- `src/components/LogicSection.tsx`: logic flow list, flowchart, changes in the flow, improvement suggestions.
- `src/components/ui.tsx`: status pills, grooved edges, `Reveal` scroll animation, `Recommendations`, `useDecisions`.
- `src/components/ConceptObject.tsx`: small clay-style SVG objects.
- `src/lib/review.ts`: layer merging, graph layout, efficiency text and suggestion rules.
- `src/lib/verdict.ts`, `src/lib/run-state.ts`: run derivations and snapshot merging.
- `src/styles.css`: visual design, responsive layout.
- `src/lib/api.ts`: single HTTP boundary, shared schema validation and fixture adapter.

The backend/UI contract is `packages/contracts/src/index.ts`. Use those types, with no SDK imports or server environment variables in UI code. Shared demo data lives in `packages/demo/src/index.ts`; it is a declared pricing scenario, not an inferred code graph.

## HTTP contract

| Endpoint | Response |
| --- | --- |
| `GET /api/health` | `Health` |
| `GET /api/runs` | `{ runs: AnalysisRun[] }` |
| `POST /api/runs` | `AnalysisRun` (202); body `{ execution, scenario: 'pricing-cache' }` |
| `POST /api/runs/import` | `AnalysisRun` (201); body is a completed/error Canonical report, maximum 1 MiB; duplicate run IDs return 409 |
| `GET /api/runs/:id` | `AnalysisRun` |
| `GET /api/runs/:id/context` | Markdown text |
| `GET /api/runs/:id/business-context` | `ContextWorkspace` |
| `POST /api/runs/:id/business-context/sources` | `ContextWorkspace`; body `ContextImport` |
| `POST /api/runs/:id/business-context/proposals` | `ContextWorkspace`; body `CreateProposal` |
| `POST /api/runs/:id/business-context/proposals/:proposalId/review` | `ContextWorkspace`; body `ReviewProposal` |

Active runs poll independently of the selected report once per second, with abort and stale-response protection when selection changes. Errors are visible; transient polling errors retry. Use Refresh to discover runs created outside this browser. Terminal failures keep their stage/error visible. Context downloads are enabled after completion.

`npm run typecheck` checks all workspaces. `npm run build --workspace @canonical/ui` builds the UI independently. The interface uses system font fallbacks if Google Fonts is unavailable.

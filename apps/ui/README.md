# UI handoff

From the repository root:

```sh
npm install
npm run dev:ui:fixture
```

Open http://127.0.0.1:5173. Fixture mode is independent of the API, Daytona, and SurrealDB. Its banner and export explicitly label every result synthetic. `New fixture` creates another illustrative run; it executes no code.

Use `npm run dev` from the root for the real local execution loop. Vite proxies `/api` to `http://127.0.0.1:3001`; select Daytona once the API reports it available. All secrets stay on the server. The normal UI never silently falls back to synthetic data.

Use **Import report JSON** to load a Canonical `report.json` produced by the CLI or downloaded from a CI artifact. The UI validates the report with `RunSchema`, saves it through the backend, refreshes history, and selects it. Importing displays recorded evidence; it does not rerun the repository. Git reports show the full baseline/candidate SHAs, changed files, and declared policy path. The evaluation button still starts the pricing fixture and is labeled accordingly when a Git report is selected. Report import is unavailable in standalone fixture mode.

The **Business context review** panel supports pasted text and `.txt`, `.md`, or `.vtt` files. Import a source, choose a segment and an exact quote, link it to an existing requirement, then review the proposal with a reviewer name. Accepted quotes appear alongside the matching candidate check. These are manually reviewed supporting context added after execution, not changes to original CI requirements or test results. Rejected/conflicting proposals remain visible. A requirement can have one approved context version per run; another proposal cannot overwrite it.

**Use synthetic example** fills an explicitly synthetic conversation for demonstrations. Standalone fixture mode also supports the full review interaction in browser memory; all its sources are forced to synthetic, and its download is labeled synthetic. Fixture state clears on reload. Backend mode loads context per run and aborts stale requests when switching reports.

## Replace these components freely

- `src/App.tsx`: workspace layout, run selection, polling and actions.
- `src/components/BusinessGraph.tsx`: React Flow concept graph, selected concept, keyboard-accessible concept buttons.
- `src/components/EvidencePanel.tsx`: approved requirements and observed evidence for the selected concept.
- `src/components/RunSummary.tsx`: execution status, timing comparison, failed checks.
- `src/components/BusinessContextPanel.tsx`: source import, manual citations, proposal review.
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

# UI handoff

From the repository root:

```sh
npm install
npm run dev:ui:fixture
```

Open http://127.0.0.1:5173. Fixture mode is independent of the API, Daytona, and SurrealDB. Its banner and export explicitly label every result synthetic. `New fixture` creates another illustrative run; it executes no code.

Use `npm run dev` from the root for the real local execution loop. Vite proxies `/api` to `http://127.0.0.1:3001`; select Daytona once the API reports it available. All secrets stay on the server. The normal UI never silently falls back to synthetic data.

## Replace these components freely

- `src/App.tsx`: workspace layout, run selection, polling and actions.
- `src/components/BusinessGraph.tsx`: React Flow concept graph, selected concept, keyboard-accessible concept buttons.
- `src/components/EvidencePanel.tsx`: approved requirements and observed evidence for the selected concept.
- `src/components/RunSummary.tsx`: execution status, timing comparison, failed checks.
- `src/styles.css`: visual design, responsive layout.
- `src/lib/api.ts`: single HTTP boundary, shared schema validation and fixture adapter.

The backend/UI contract is `packages/contracts/src/index.ts`. Use those types, with no SDK imports or server environment variables in UI code. Shared demo data lives in `packages/demo/src/index.ts`; it is a declared pricing scenario, not an inferred code graph.

## HTTP contract

| Endpoint | Response |
| --- | --- |
| `GET /api/health` | `Health` |
| `GET /api/runs` | `{ runs: AnalysisRun[] }` |
| `POST /api/runs` | `AnalysisRun` (202); body `{ execution, scenario: 'pricing-cache' }` |
| `GET /api/runs/:id` | `AnalysisRun` |
| `GET /api/runs/:id/context` | Markdown text |

Active runs poll independently of the selected report once per second, with abort and stale-response protection when selection changes. Errors are visible; transient polling errors retry. Use Refresh to discover runs created outside this browser. Terminal failures keep their stage/error visible. Context downloads are enabled after completion.

`npm run typecheck` checks all workspaces. `npm run build --workspace @canonical/ui` builds the UI independently. The interface uses system font fallbacks if Google Fonts is unavailable.

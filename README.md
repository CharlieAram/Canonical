# Canonical

Canonical helps people review a coding agent's changes in business terms: what changed, which business rules still hold, and what performance tradeoffs were measured. The intended product turns a commit into a business graph, executes checks in Daytona, stores its evidence in SurrealDB, and exports business context for the next coding agent.

The runnable project supports a built-in pricing fixture and real Git comparisons through Daytona. A cache makes repeat quotes faster but lets a retail customer receive a wholesale customer's price. The dashboard connects that failed requirement to the business graph and measured results. The sibling `CanonicalTestbed` repository supplies baseline, broken-cache, and corrected-cache commits for the same review loop.

## Start the local MVP

Requires Node.js **22.12 or newer** and npm. No service credentials are required for the default mode.

```sh
npm install
cp -n .env.example .env
npm run dev
```

Open the UI at **http://localhost:5173**. Start a local analysis, inspect the pricing failure and benchmark, select a graph concept, and download the context file. The API listens on `127.0.0.1:3001`; Vite proxies `/api` to it.

The baseline should pass the account-pricing check. The candidate deliberately fails it: the retail account receives **$80 instead of $100**. A completed analysis can contain failed business checks; an execution error is a separate state. Benchmark numbers are real measurements of a synthetic fixture with a simulated upstream delay.

The default store is memory, so API restarts clear run history. [Enable Daytona and SurrealDB](integrations/README.md) when you want sandbox execution and persistent graph storage.

CLI and CI reports do not automatically appear in an API using memory storage. Use **Import report JSON** in the dashboard to load the generated `report.json`. Importing displays recorded evidence; it does not execute the repository again.

For local SurrealDB, start Docker, run `npm run db:up`, `npm run db:init`, and `npm run db:smoke`, then set `CANONICAL_STORE=surreal` in `.env` and restart the API. Initialization is an explicit setup step for a fresh database. A hosted instance needs its database connection URL, namespace, database, username/password, and matching authentication level. An MCP server URL or Cloud management token does not configure this adapter.

## Review real commits

Set `DAYTONA_API_KEY` in the ignored `.env`. From this checkout, compare the sibling test repository:

```sh
npm run analyze -- --execution daytona --repo ../CanonicalTestbed --base main --head demo/product-cache --output .canonical/output/broken
npm run analyze -- --execution daytona --repo ../CanonicalTestbed --base main --head demo/account-cache --output .canonical/output/fixed
```

The first command is expected to exit **1** for the cross-account pricing failure; the second should exit **0**. Run them separately so an expected failure does not stop the corrected comparison. Each output folder contains `report.json`, `context.md`, `report.md`, and a report named by its run ID. Import either `report.json` in the UI to compare its evidence.

The runner resolves both refs to full SHAs, reads approved policy from the baseline commit, and checks out each exact revision in a separate Daytona sandbox. The checks come from Canonical, so candidate changes cannot replace the harness or weaken their approved baseline policy. This currently supports the small `pricing-v1` service contract, not arbitrary repository test commands. [Real repository and CI guide](docs/REAL_CI.md).

## Work independently

| Owner | Main files | Development command |
|---|---|---|
| UI teammate | `apps/ui/` | `npm run dev:ui:fixture` |
| Backend | `apps/api/`, `packages/runner/`, `integrations/` | `npm run dev:api` |
| Shared contract | `packages/contracts/src/index.ts` | Agree schema changes together |

Fixture UI mode works without the API or sponsor credentials and uses declared example data. Run `npm run dev` to test actual local execution. [The handoff guide](docs/DEVELOPMENT.md) explains the contract and the next vertical slices.

```text
apps/ui/                    React + Vite dashboard
apps/api/                   HTTP API, configuration, storage selection
packages/contracts/         Shared Zod schemas and TypeScript types
packages/demo/              Declared business graph and UI fixture
packages/runner/            Evaluation pipeline and context export
integrations/daytona.ts     All Daytona SDK calls
integrations/surrealdb.ts   Database connection, persistence, graph traversal, live helper
integrations/schema.surql   Database schema
examples/quote-shop/        Executable pricing fixture
checks/                     Trusted checks and benchmark harness
scripts/                    Analysis CLI and sponsor smoke checks
```

## Verify and export

```sh
npm run check
npm run analyze -- --execution local
```

`check` runs type checking, tests, and the production UI build. The analysis CLI writes its report and business context under `.canonical/output`. It intentionally exits with status **1** when the candidate fails a business check, after saving the evidence; status **2** indicates an execution error. The pricing-cache fixture is expected to return 1.

Verification passed 26 tests and the production build. An actual Git comparison in Daytona passed all baseline checks and caught the candidate's $80 retail-price regression without cleanup warnings. SurrealDB `3.3.0` checks include Git provenance persistence. Sponsor smoke tests remain explicit commands because they require configured services. See the [integration verification notes](integrations/README.md#verification-and-dependency-notes).

## What this slice proves

The MVP connects a declared business map to executed checks, benchmark evidence, and a context export. It supports actual Git revisions in Daytona, report imports, and optional SurrealDB storage behind the same contract. The testbed includes a GitHub Actions workflow for unit tests and the business review; hosted execution is a separate verification step, not implied by the workflow's presence.

Inferred business meaning, signed app previews, and live database events in the browser remain subsequent slices. Graph provenance distinguishes a **declared fixture** from **declared policy** read from a Git baseline; neither claims AI extraction. The browser polls pending runs. Local execution runs only the owned fixture; repository execution requires Daytona.

For business context from calls, the [meeting-context scope](docs/MEETING_CONTEXT.md) recommends transcript paste/import first and Fathom when a new listener is needed. This connection is scoped, not implemented.

See [PLAN.md](PLAN.md) for the vertical-slice roadmap, [RESEARCH.md](RESEARCH.md) for the platform research, and [integrations/README.md](integrations/README.md) for SDK setup and verification.

Hosted demonstration verified: [broken cache fails business review](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38941269929), while [account-scoped cache passes](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38941270563). Ordinary unit tests pass on both branches.

## Add conversation context

Open a completed report and use **Bring the business decision into view**. Paste
or import `.txt`, `.md`, or `.vtt` text, select an exact quote, propose its connection
to an existing requirement, and review it. **Use synthetic example** provides an
explicitly labeled demo conversation. Accepted quotes appear alongside the
candidate's execution evidence and in the agent-context download.

This is manual citation review. Context added after execution does not change the
original policy or CI outcome. SurrealDB stores the provenance as native graph
relationships when configured; memory mode works without credentials.
See [the transcript review guide](docs/TRANSCRIPT_CONTEXT.md).

## Push-driven commit review

The live review pipeline reads exact Git revisions, runs independent object-layer
and logic-flow extraction tasks, and then executes the approved bill of business
in Daytona. Each task publishes its real status and source-cited results to the
shared SurrealDB instance. The API streams those updates through `/api/events`;
the UI discovers CI-created runs automatically and displays both layer diffs.

Extraction currently uses the TypeScript compiler's AST parser and is labeled
**static analysis**. It supports the prepared `src/pricing.mjs` service; it does
not claim general repository understanding or LLM inference. The bill's checkmarks
and crosses come exclusively from executed baseline/candidate checks; pending
and execution errors stay distinct. See [the push demo guide](docs/PUSH_DEMO.md).

Live push verification: [prepared regression](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38946185169)
produces the pricing cross; [prepared repair](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38946314398)
produces three checks. Both appear through shared storage/live events without
manual report imports. Use a fresh `demo/` branch from Testbed `main` to rehearse.

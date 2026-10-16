# Canonical

Canonical helps people review a coding agent's changes in business terms: what changed, which business rules still hold, and what performance tradeoffs were measured. The intended product turns a commit into a business graph, executes checks in Daytona, stores its evidence in SurrealDB, and exports business context for the next coding agent.

The first runnable slice uses a small pricing fixture. A cache makes repeat quotes faster but lets a retail customer receive a wholesale customer's price. The dashboard connects that failed requirement to the business graph and the measured results.

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

For local SurrealDB, start Docker, run `npm run db:up`, `npm run db:init`, and `npm run db:smoke`, then set `CANONICAL_STORE=surreal` in `.env` and restart the API. Initialization is an explicit setup step for a fresh database.

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

Initial verification passed 14 tests, a real Daytona baseline smoke run, and SurrealDB `3.3.0` persistence and live-notification checks. See the [integration verification notes](integrations/README.md#verification-and-dependency-notes).

## What this slice proves

The MVP connects a declared business map to executed checks, benchmark evidence, and a context export. It provides optional Daytona execution and SurrealDB adapters behind the same contract.

Actual Git revision comparison, inferred business meaning, a CI trigger, signed app previews, and live database events in the browser are subsequent slices. The current graph is a **declared fixture**, not AI extraction; the browser polls pending runs. Local execution runs only the owned fixture, not arbitrary repository code.

See [PLAN.md](PLAN.md) for the vertical-slice roadmap, [RESEARCH.md](RESEARCH.md) for the platform research, and [integrations/README.md](integrations/README.md) for SDK setup and verification.

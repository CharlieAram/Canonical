# Sponsor integrations

The server owns service credentials. The UI imports the shared contract and calls the HTTP API; it does not import either SDK. Copy `.env.example` to `.env` before configuring services.

| File | Responsibility |
|---|---|
| [daytona.ts](daytona.ts) | Create a sandbox, upload fixture or Git bundle, verify revision, execute trusted checks, clean up |
| [surrealdb.ts](surrealdb.ts) | Initialize the database explicitly, connect, save/load runs and native relations, traverse concepts, subscribe to run changes |
| [schema.surql](schema.surql) | Application schema |

The dependency lockfile pins the installed dependency tree. The direct integration versions are Daytona SDK `0.224.1` and SurrealDB JavaScript SDK `2.1.1`; the local database image is `3.3.0`.

## Daytona

Set `DAYTONA_API_KEY` in `.env`. `DAYTONA_API_URL` defaults to `https://app.daytona.io/api`; `DAYTONA_SNAPSHOT` is optional. Restart the API after changing configuration.

```sh
npm run daytona:smoke
npm run analyze -- --execution daytona
```

The adapter uses `Daytona`, `create`, `sandbox.fs.uploadFile`, `sandbox.process.executeCommand`, and `delete`. It uploads the same owned fixture and trusted harness used locally. Validated results include the sandbox ID; cleanup runs in `finally`, with sandbox TTL as a fallback. The CLI saves the failed candidate's report before returning its nonzero business-check status.

The repository CLI uploads a Git bundle of the requested commits, clones and checks out each exact SHA in a separate Daytona sandbox, and runs the trusted pricing harness. Requirements come from the baseline `.canonical/business.json`. App previews remain a later slice. Repository code runs inside Daytona; provider and database credentials stay in the control process. See [real CI setup](../docs/REAL_CI.md).

Official references: [TypeScript SDK](https://www.daytona.io/docs/en/typescript-sdk/), [Daytona benchmark example](https://github.com/daytona/guides/tree/main/typescript/vercel-ai-sdk/multi-language-benchmark-agent).

## SurrealDB

With Docker running, start the pinned local service:

```sh
npm run db:up
npm run db:init
npm run db:smoke
```

Use these values in `.env`, then restart the API:

```dotenv
CANONICAL_STORE=surreal
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NAMESPACE=canonical
SURREAL_DATABASE=development
SURREAL_AUTH_LEVEL=root
SURREAL_USERNAME=root
SURREAL_PASSWORD=canonical-local-only
```

These credentials are for local development. For a provisioned instance, replace the endpoint and credentials with that instance's configuration. `SURREAL_AUTH_LEVEL` accepts `root`, `namespace`, or `database`; use the scope of your account. The default is `root`. `CANONICAL_STORE=memory` restores the credential-free mode.

`npm run db:init` calls `initializeSurreal(config)` to bootstrap the namespace and database on a fresh local server. Provision production databases separately with appropriate administrative credentials; normal application startup does not require root access.

The adapter connects through `Surreal.connect`, applies `schema.surql` within the configured database, and uses bound query parameters and `RecordId` values. The application account therefore needs permission to define that schema. It stores run data separately from concept nodes and native `depends_on` relations, with each graph scoped to its run. `getDownstreamConcepts` demonstrates graph traversal. `watchRuns` uses the SDK's managed live subscription over WebSocket and returns a cleanup function.

The browser currently polls runs. To add live UI delivery, have the backend subscribe, notify the client, and refetch authoritative state on reconnect; the helper alone is not an end-to-end live feature.

```sh
npm run test:surreal
npm run db:down
```

The integration test requires the configured database. `db:down` stops the local service; the Compose volume preserves its data.

Official references: [JavaScript SDK](https://surrealdb.com/docs/reference/javascript), [SDK live queries](https://surrealdb.com/docs/reference/javascript/concepts/live-queries), [LIVE SELECT constraints](https://surrealdb.com/docs/reference/query-language/statements/live-select).

## Verification and dependency notes

The initial verification passed all 14 tests. A real Daytona smoke run passed all three baseline checks and requested sandbox cleanup without warnings. Integration checks against an actual SurrealDB `3.3.0` server passed graph persistence and live notifications. Run the smoke commands with your own configuration to verify your environment.

The initial dependency audit reports four high-severity entries from one transitive `braces` advisory through Daytona's `fast-glob` dependency. There is no fixed release available in the installed dependency path. This adapter does not accept user-provided glob patterns; reassess the dependency when upgrading or adding file-selection features.

## Conversation provenance

[surreal-context.ts](surreal-context.ts) implements atomic context-workspace updates
and native source/segment/proposal/approval graph relationships. The API's reviewed
quotes come from graph traversal through `getRequirementProvenance`, while run
execution evidence remains unchanged. The context integration test exercises
transaction rollback, competing writers, and isolated citation paths. See
[transcript review](../docs/TRANSCRIPT_CONTEXT.md) for setup and test commands.

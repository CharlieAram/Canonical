# Real Git comparisons and CI

The sibling `../CanonicalTestbed` checkout supplies real commits for Canonical's `pricing-v1` harness. The private [GitHub testbed](https://github.com/CharlieAram/CanonicalTestbed) is published with baseline, broken-cache, and corrected-cache branches; its Daytona Actions secret is configured.

Verified hosted runs:

- [Broken cache: business check fails](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38941269929). Ordinary unit tests pass, baseline business checks pass, and candidate account pricing fails: Beta receives $80 instead of $100.
- [Corrected cache: all checks pass](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38941270563). Unit tests and all three business checks pass; warm repeat quotes use one upstream call instead of 23.

Both downloaded CI artifacts were checked against the workflow's exact head SHA and sandbox evidence; neither reported cleanup warnings. Both reports have been imported into the local dashboard. Canonical's own [check workflow](https://github.com/CharlieAram/Canonical/actions/runs/38941165821) passes. Local validation also passed 26 tests, the production build, real SurrealDB Git-provenance persistence/traversal/live checks, and desktop/mobile report import with context download.

## Revisions and expected results

| Ref | Behavior | Ordinary tests | Canonical review |
|---|---|---|---|
| `main` | Fetches each account's price without caching | Pass | Baseline requirements pass |
| `demo/product-cache` | Reuses prices by product, losing account identity | Pass | Fails account-specific pricing |
| `demo/account-cache` | Caches by account and product | Pass, including a cross-account regression test | Requirements pass with fewer upstream calls |

The benchmark uses a simulated upstream delay and records actual elapsed samples and upstream-call counts. It demonstrates the effect of caching in this service, not production latency. The business map and meeting notes in the testbed are explicitly synthetic demo context.

## Run the same comparison locally

From the `Canonical` checkout, install dependencies and put `DAYTONA_API_KEY` in ignored `.env`. Keep the API running with `npm run dev` if you want to import the resulting reports into the dashboard.

```sh
npm run analyze -- --execution daytona --repo ../CanonicalTestbed --base main --head demo/product-cache --output .canonical/output/broken
```

This is expected to exit 1 after writing evidence. Then run the corrected comparison separately:

```sh
npm run analyze -- --execution daytona --repo ../CanonicalTestbed --base main --head demo/account-cache --output .canonical/output/fixed
```

The corrected comparison should exit 0. Full commit SHAs can replace either friendly ref. Repository comparisons require Daytona; `--execution local` is available only for Canonical's owned fixture.

Each output directory contains:

- `report.json`: structured report for the UI and API.
- `<run-id>.json`: the same report under a unique filename.
- `context.md`: business rules, revision provenance, and executed evidence for an agent.
- `report.md`: the same Markdown content for a CI job summary.

CLI exit codes are 0 when all executed checks pass, 1 when a completed review contains a failed business check, and 2 for an evaluation/runtime error. Configuration or invalid-argument failures can stop before report generation; an absent artifact is not a passing review.

## Display a report

Open the dashboard and choose **Import report JSON**, then select `.canonical/output/broken/report.json` or `.canonical/output/fixed/report.json`. The header identifies Git provenance and the revision SHAs. Imports display recorded evidence without executing code again.

The equivalent HTTP request is:

```sh
curl --fail-with-body http://127.0.0.1:3001/api/runs/import \
  -H 'Content-Type: application/json' \
  --data-binary @.canonical/output/broken/report.json
```

Imports preserve the report ID, accept only completed/error reports up to 1MiB, and reject duplicate IDs with HTTP 409. The API cannot overwrite a running analysis through import. This local development endpoint is not an authenticated public CI receiver.

Memory storage belongs to each process. A CLI run or GitHub Actions job does not automatically update the local API's history; import its downloaded artifact. API restarts clear imported memory reports. SurrealDB can provide shared persistence when both processes use the same database configuration. The original artifact workflow used memory storage. The live review workflow now requires the shared SurrealDB configuration in Actions secrets and publishes progress and results directly. Artifacts remain available as a fallback. See [the push demo guide](PUSH_DEMO.md).

For hosted SurrealDB, supply the database connection URL, namespace, database, username/password, and matching authentication level through the documented `SURREAL_*` variables. An MCP endpoint or a Cloud management API token is not the database login expected by this adapter. See [integration setup](../integrations/README.md).

## GitHub Actions setup and execution

The testbed's `.github/workflows/canonical.yml` has separate unit-test and Canonical-review jobs. It runs on pull requests, pushes to `demo/**`, and manual dispatch. All three branches are published and pin the public Canonical runner at `331a6910ad5c1b64379905f89d3cb7ba7e34f40c`. `DAYTONA_API_KEY` is configured as an encrypted repository Actions secret. When reusing the workflow elsewhere, retain a published, fixed runner SHA and configure that repository’s own secret.

The workflow checks out full history and selects exact pull-request base/head SHAs, the selected manual refs, or a push's merge base with `main`. It checks out the Canonical tool separately at the fixed revision and installs its lockfile dependencies. If that tool repository is private, the checkout needs read access to it; the testbed repository's default token does not automatically grant cross-repository private access.

The credential-bearing review is limited to branches in the same repository. Fork pull requests skip it. The workflow uses ordinary `pull_request` events and does not use `pull_request_target`. Daytona credentials are injected into the trusted control-runner step, not the sandbox; SurrealDB credentials and meeting-provider keys are not needed by repository code.

The broken cache is expected to leave ordinary tests green and the Canonical review red. The corrected cache should make both green. The `always()` summary/artifact steps retain available evidence after a failed review. Download `canonical-review` from the Actions run, then import its `report.json` locally. The live review workflow also publishes directly to SurrealDB; `/api/events` delivers those snapshots to the dashboard. Artifacts remain a downloadable record.

## What is trusted and what is supported

Canonical resolves Git refs before execution, reads `.canonical/business.json` from the immutable baseline, and creates a bundle containing history reachable from the two requested commits. Uncommitted files and local Git configuration are excluded. The developer's checkout and refs remain unchanged.

Each Daytona sandbox receives that bundle and Canonical's separate harness. The adapter clones, checks out the requested SHA, verifies `rev-parse HEAD`, executes the harness, validates the output, and requests cleanup. Run evaluation rejects evidence with a missing or different commit SHA. These checks prevent accidental revision mix-ups; executing repository code in the same sandbox is not an attestation boundary against adversarial code deliberately forging its output.

The narrow service contract is `src/pricing.mjs` exporting `createQuoteService(upstreamMs)`, returning `quote(account, sku, quantity)` and an `upstreamCalls` getter. Approved requirement IDs are `account-price`, `repeat-price`, and `positive-quantity`. Dependencies, arbitrary build commands, code-to-concept inference, previews, and general-purpose repository analysis are outside this slice.

[Meeting context](MEETING_CONTEXT.md) scopes the next business-context source: paste or import a transcript, review proposed requirements with their original quotes, then optionally pull calls from Fathom. Meeting imports and listener connections are not implemented by this CI slice.

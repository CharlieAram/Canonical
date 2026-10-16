# Push a regression, watch the business review, then repair it

The intended demo is one continuous path: push a real Testbed commit, let GitHub
Actions compare it with the approved baseline, execute checks in Daytona, persist
progress to SurrealDB Cloud, and watch the existing dashboard update. Artifact
downloads remain useful evidence, but are not the transport for this live path.

The hosted path is verified:

- [Regression push b4f754f](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38946185169): unit tests pass; bill of business fails account pricing and passes its other two entries. Report `b85c07c4-5223-453e-968a-5c8872145ca8`.
- [Repair push 9331517](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38946314398): unit tests and all three business entries pass. Report `6e200269-dd02-41e2-a619-33585316e314`.

Live SSE observation recorded queued/running/completed extraction and check tasks.
A browser left open before the repair push discovered the new review and displayed
its progress without a refresh or import. Object extraction resolves the cache key
as `sku` for the regression and `JSON.stringify([account, sku])` for the repair.
Both layers retain source citations with exact commit SHAs. The normal test/build
check passes 64 tests. These are static-analysis workers, not model-backed agents.

## Wire the shared database

Use one namespace and database for both the API and the CI runner. Configure the
API's ignored `.env` with `CANONICAL_STORE=surreal` and the six `SURREAL_*` variables
listed below. For an existing Cloud namespace/database, `npm run db:smoke`
applies the application schema and verifies connectivity; start the API/UI with
`npm run dev`. `npm run db:init` is only for bootstrapping a fresh local server
with credentials authorized to create namespaces/databases.

On `CharlieAram/CanonicalTestbed`, configure these encrypted Actions secrets:

| Secret | Purpose |
| --- | --- |
| `DAYTONA_API_KEY` | Creates separate execution sandboxes |
| `SURREAL_URL` | Database connection endpoint; use the Cloud TLS endpoint |
| `SURREAL_NAMESPACE` | The same namespace selected by the API |
| `SURREAL_DATABASE` | The same database selected by the API |
| `SURREAL_USERNAME` | Database login user |
| `SURREAL_PASSWORD` | Database login password |
| `SURREAL_AUTH_LEVEL` | The user's scope: `database`, `namespace`, or `root` |

For a user created `ON DATABASE`, select `database`. Use the database connection
credentials, not a Cloud management token or MCP endpoint. Never commit the values
or paste them into a workflow. The workflow supplies credentials only to the
trusted runner's analysis step. Repository code runs in Daytona without inheriting
the runner's environment.

Testbed `main` and `demo/live-review` pin the published Canonical runner at
`a65548733c9a67cfbc8df706ceba472c3d2a3baa`. The shared database secrets are configured.
When adopting a newer runner, update this fixed SHA explicitly before preparing
the demo branch. `CANONICAL_STORE` is explicitly `surreal`; missing database configuration
is an error, never a silent memory fallback.

Keep fork PR filtering and read-only repository permissions. This path does not
require exposing the local API publicly or accepting anonymous CI webhook writes.
Model integration is optional and must be configured explicitly if chosen; no
model credential or model-driven behavior is implied by these database settings.

## Prepare and push the regression

Start from a clean Testbed checkout containing the updated workflow. The original
regression and repair commits modify service logic without redefining business
policy. The commands below create new commits by cherry-picking their patches.

```sh
cd ../CanonicalTestbed
git switch main
git pull --ff-only
git switch -c demo/rehearsal-1
git cherry-pick 2dfe37d
npm test
git push -u origin demo/rehearsal-1
```

The verified `demo/live-review` branch already contains the repair. If `demo/rehearsal-1` already exists, inspect it and resume it, or use a fresh
`demo/` branch name. Do not reset or force-push existing work. Every push under
`demo/**` triggers a real hosted review. Keep the dashboard open before pushing
to see actual progress arrive from the shared database.

The baseline is `git merge-base origin/main HEAD`, and the candidate is the push's
exact head SHA. CI checks out complete Git history and runs a fixed Canonical
runner. Approved policy is loaded from the baseline commit. The candidate cannot
approve its own implementation by changing its policy file.

## Read the review as it progresses

The review has three independently reported tasks:

| Task | Evidence to inspect |
| --- | --- |
| Objects | Before/after entities and relationships, with source paths, exact commit SHAs, line ranges, and excerpts |
| Logic | Before/after implementation behavior and changes, with source citations and stated limitations |
| Business checks | Baseline and candidate results executed in separate Daytona sandboxes |

Each task reports `queued`, `running`, `completed`, or `error`. These are execution
states, not evidence of separate autonomous model agents. Read the task's method:
`static-analysis` is deterministic source processing in the CI control runner, `model` means an actual
configured model call, and `daytona` is sandbox execution. A model-derived claim
must be labeled as inference. Static extraction must not be presented as AI
reasoning, and source citations do not prove a business requirement passed.

The objects and logic layers distinguish additions, removals, modifications, and
unchanged items. Inspect the pricing implementation citation to connect an inferred
or statically extracted caching change to the actual diff. The declared business
policy and reviewed meeting context retain their own provenance.

The bill of business lists the approved requirements and their baseline/candidate
evidence. Interpret statuses conservatively:

- `pending`: required execution evidence has not arrived. It is not a pass.
- `passed`: executed evidence supports the displayed requirement for that revision.
- `failed`: an executed check observed a violation; inspect expected and actual values.
- `error`: evaluation could not establish an outcome. It is not proof of a policy violation.

Inspect the candidate's outcome alongside the baseline and exact commit SHAs.
On the broken cache, ordinary tests should pass, baseline account pricing should
pass, and candidate account pricing should fail: Alpha receives $80 and Beta also
receives $80, although Beta should receive $100. The faster warm requests use a
simulated upstream delay; the result is a measured demo effect, not a claim about
production performance.

## Push the repair

After the regression's report is complete:

```sh
git cherry-pick 22ebe77
npm test
git push
```

The cache key now includes both account and product. The new run should show the
source change, preserve the warm-cache benefit, and pass the three business checks.
The workflow still compares against the approved `main` baseline, rather than
using the broken implementation as its baseline. Keep the failed run in history
so the audience can inspect both actual outcomes.

## Verify the path and diagnose missing updates

Check the GitHub job's head SHA against the report's candidate SHA, then verify the
same run ID in dashboard history and `report.json`. Both revision evaluations must
identify their requested commit. Artifacts `report.json`, `report.md`, and
`context.md` are uploaded even when a completed review finds a business violation.

A completed violated requirement intentionally leaves the Canonical job red; a
runtime or configuration failure is a different outcome. Missing artifacts,
unfinished tasks, or an unavailable database must never be shown as a successful
review. If no run appears, inspect workflow configuration and database connectivity
first. If the record exists but the dashboard is stale, check that API and CI use
the same namespace/database and inspect the API's live update connection.

This demo does not require an active meeting listener. Synthetic meeting notes are
labeled as such; imported and accepted transcript quotations are retrospective
supporting context unless a later run explicitly consumes a reviewed policy change.

# Model-assisted object and logic extraction

Repository reviews use two independent OpenAI extraction agents: one for the
object layer and one for the logic layer. Each task examines both immutable revisions,
with source structure and citations grounded by the TypeScript parser. These are
two bounded extraction tasks with independent results, not an open-ended agent
loop. The existing static extractor remains an explicit alternative.

Each task sends an initial request and may make one correction request if the
returned diagram fails validation. Provider errors are not retried. Each request
has a 120-second maximum deadline and a 10,000-token output cap. GPT-5 requests use low reasoning
effort. The integration sets `store: false` and validates structured responses
before accepting their domain data. These bounds are implemented in
`integrations/openai.ts`; exceeding them produces an extraction error.

The default model is `gpt-5.4-mini`, which supports the Responses API and structured
outputs according to the [official OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
Account access is checked by an actual request; a configured name alone is not
proof that a provider call succeeded.

## Configuration

Keep credentials in the ignored backend `.env`, never in browser settings:

```dotenv
CANONICAL_EXTRACTION=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
```

| Setting | Behavior |
| --- | --- |
| `CANONICAL_EXTRACTION=auto` | Uses OpenAI when a nonblank key is present; otherwise uses static extraction |
| `CANONICAL_EXTRACTION=static` | Uses static extraction even when a key is present |
| `CANONICAL_EXTRACTION=openai` | Requires a nonblank key; missing credentials fail during configuration |
| `OPENAI_API_KEY` | Server-side provider key; blank values count as absent |
| `OPENAI_MODEL` | Exact model ID to request; defaults to `gpt-5.4-mini` |

`auto` resolves the choice before execution. Once OpenAI is selected, a failed
provider call does **not** silently become a static success. Explicit `openai`
mode is useful for a demo that must prove actual model execution. The built-in
local fixture continues to use its existing evaluator and does not invoke these
repository extraction calls.

Run an actual repository comparison through the existing CLI:

```sh
npm run analyze -- --execution daytona --repo ../CanonicalTestbed --base main --head demo/product-cache --output .canonical/output/model-review
```

The CLI resolves Git commits and reads approved business policy from the baseline,
then selects `createModelExtractors` or the static extractors. Daytona credentials
are still required for repository execution. Shared SurrealDB configuration remains
independent of the extraction choice.

## What the model contributes

Object and logic tasks receive source material from the same two exact commit
SHAs used by execution. Parsed source references constrain where their claims can
point. Each layer contains before/after entities, relationships, changes, a summary,
and limitations. Model-assisted results carry `model-inference` provenance and
the task method is `model`. Static results remain labeled `static-analysis`.

Source citations identify a path, commit, line range, and exact excerpt. They make
the explanation inspectable; they do not establish that an inferred interpretation
is correct. Review the cited implementation when a model description is ambiguous.

The model does not approve business policy, create executable evidence, or set the
bill-of-business verdicts. Those verdicts come exclusively from trusted checks
executed against both revisions in Daytona. A fast cache with failed account
pricing remains a failed requirement regardless of what the model says about it.

## Evidence of actual provider execution

Successful model layers record `model.provider`, `model.name`, and the final
provider `model.responseId`. `model.responseIds` and `model.attempts` retain the
complete initial/correction request lineage. Token usage is recorded as `model.inputTokens` and
`model.outputTokens`, summed across attempts when supplied for every request. Inspect these fields on both
`review.objects` and `review.logic` in `report.json`. The pipeline also records
task state and progress events independently for each call.

Do not present a configured model name, queued task, synthetic fixture, or manually
written summary as a completed AI run. A genuine successful run has actual provider
response metadata, validated layer output, and the expected exact-revision check
results. Refusals, incomplete or invalid output, timeouts, and provider failures
must leave the affected extraction task in error. Independent executed check
evidence is retained, while the overall review remains incomplete.

## CI setup

Add `OPENAI_API_KEY` to Testbed repository Actions secrets and inject it only into
the trusted Canonical runner's analysis step. Set `CANONICAL_EXTRACTION=openai`
and `OPENAI_MODEL=gpt-5.4-mini` in that step to require real calls. Keep existing
Daytona and SurrealDB secrets there as well, and pin a published Canonical commit
that includes this integration.

The API key is not sent to repository code in Daytona or to the browser. Object
and logic extraction do send selected repository source and parsed context to
OpenAI. Transcript imports remain a separate manual review flow and are not
automatically included in these repository calls.

Before a live demo, verify one real provider-backed review and inspect its response
IDs and usage. Then use the regression/repair sequence in [PUSH_DEMO.md](PUSH_DEMO.md).
No additional hosted run is implied by adding configuration or passing unit tests.

## Verified hosted model demo

Both model-backed pushes have been exercised end to end with the dashboard open:

- [Broken cache, commit 395053d](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38949432996): model layers complete, account pricing fails, and the other two business checks pass. Report `ddaa31e7-115e-4550-a1fd-252c73e56d1e`.
- [Fixed cache, commit efdd5a4](https://github.com/CharlieAram/CanonicalTestbed/actions/runs/38949600157): model layers complete and all three business checks pass. Report `272b642e-bc75-40bf-8e51-e468fb4e8150`.

Both used `gpt-5.4-mini-2026-03-17`. Object extraction validated on its first request;
logic extraction used its one allowed validation repair. All request IDs and
combined usage remain in the reports. Browser observation confirmed automatic run
discovery, model tasks running, Daytona execution, both cited layer diffs, and the
final verdicts without refreshing or importing reports. The full check passes 90
tests and the production UI build.

Testbed `main` now pins runner `9a8c0d37d7dec690933943bb82584e3bc8e3c512` and
requires the configured OpenAI secret. The completed `demo/model-review` branch
contains the repaired implementation. Start a fresh `demo/` branch from `main`
to replay the prepared regression and repair using [the push guide](PUSH_DEMO.md).

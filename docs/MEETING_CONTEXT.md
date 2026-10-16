# Meeting context: transcript first, Fathom when capture is needed

Research checked October 16, 2026. This is an implementation scope; no listener account, recording, import endpoint, or provider connection has been created by this document.

**Start with pasted text and `.txt`, `.md`, or `.vtt` imports. Choose Fathom if we need a new call listener.** This lets us demonstrate the useful chain immediately: product conversation → proposed business rule → reviewed requirement → failed check on a real commit. Capture and synchronization can be added behind the same import contract.

The recommendation is based on integration work, not a claim that one provider has universally better transcription. If an existing meeting tool already supplies a transcript, use that. Starting a new transcription service just to obtain the first business rule adds unnecessary account and recording setup.

## Options and access caveats

| Option | What we can ingest | Setup and current constraints | Decision |
|---|---|---|---|
| Paste / local transcript file | Text, Markdown, WebVTT, explicit meeting metadata | No provider account or public endpoint. Preserve available line numbers and timestamps; missing metadata remains unknown. Manual notes must be labeled as notes, not a verbatim transcript. | First vertical slice. |
| Fathom | Post-call speaker segments and timestamps through REST; transcript clipboard copy | API keys and webhooks are included on all plans. Keys access the user's available meetings. A call URL identifier is **not** the API `recording_id`. API transcripts become available after processing; there is no live transcript API. [API FAQ](https://developers.fathom.ai/faq) | Recommended new listener. Start with clipboard copy, then a personal-key pull. |
| Fireflies | GraphQL transcript retrieval and audio uploads | Current docs explicitly cover Free API access (30 requests/minute and 500/day; an initial API trial uses higher limits). [API limits](https://docs.fireflies.ai/fundamentals/limits) UI downloads require Pro or above, including Markdown/JSON transcripts. [Download guide](https://guide.fireflies.ai/articles/3319752033-how-to-download-transcripts-summaries-and-meeting-recordings-from-fireflies) | Viable alternative if uploading an existing recording is essential; REST plus clipboard is a simpler first Fathom path. |
| Granola | Notes, transcript, summary through official API; historical CSV export | API keys and webhooks require Business or Enterprise. [Official API access](https://docs.granola.ai/help-center/sharing/integrations/granola-api) Historical CSV includes owned notes with summaries and transcripts, is delivered asynchronously by email, and is not a continuous sync mechanism. [Export docs](https://docs.granola.ai/help-center/sharing/exporting-notes) | User has no account; do not adopt solely for this demo. Keep a future adapter possible. |
| Existing Google Meet / Zoom | Native transcript copied or exported | Meet transcripts require an eligible Workspace edition and are stored in the organizer's Drive. [Meet transcript guide](https://support.google.com/meet/answer/12849897?hl=en) Zoom meeting-transcript downloads can provide VTT; the documented feature requires Pro, Business, or Enterprise and enabled settings. [Zoom transcript guide](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0085675) | Best if already enabled; do not assume a free personal account has it. |
| Recall.ai | Programmatically provisioned recording bots and real-time utterances | Real-time setup needs a provider account/key, a stable public endpoint, signature verification, and bot/transcript lifecycle handling. Recall recommends asynchronous transcription when a use case can wait until after the call. [Real-time guide](https://docs.recall.ai/docs/bot-real-time-transcription) | Defer unless owning an embedded meeting recorder becomes a product requirement. |

Fathom's UI supports **Copy Transcript**, rather than a direct transcript-file download. Paste that text into Canonical or save it to a local text file. [Fathom copy guide](https://help.fathom.video/en/articles/296000)

Fireflies is not disqualified by a supposed paid-only API: that would contradict its current limits documentation. Its API uses a user API key as a bearer token at `https://api.fireflies.ai/graphql`. [Quickstart](https://docs.fireflies.ai/getting-started/quickstart) The choice of Fathom here is a judgment about the simplest two-endpoint integration and manual fallback.

## Slice 1: conversation to reviewed requirement

Build one complete flow before a provider connection:

1. Import one transcript or paste text; enter a title, project, optional meeting date, and optional source URL. Explicitly choose transcript, meeting notes, or synthetic demo data.
2. Store the immutable original and normalized segments. Compute a content hash so importing the same artifact does not create duplicate evidence.
3. Extract candidate requirements with exact supporting quotes and segment references. Reuse the project's configured extraction provider; a manually selected quote and authored candidate must also work without a model key.
4. Show proposed rules beside their source quotes in a review drawer. Accept, edit, reject, or mark a conflict. Approval creates a versioned requirement with reviewer and source lineage.
5. Connect the approved requirement to a business concept and an existing trusted check. Show whether there is executable coverage; importing a rule does not automatically create or validate its test.
6. Run the existing commit comparison. The failed pricing check opens the rule and original conversation excerpt. Export approved context and citations for the coding agent.

Use this explicitly **synthetic example**, never presented as a recorded customer meeting:

```text
[00:00:12] Product owner: Alpha is wholesale and pays eighty dollars. Beta is retail and pays one hundred.
[00:00:21] Product owner: A quote must always use the requesting account's own price, even when we cache it.
[00:00:34] Engineer: We'll improve repeated lookups, but the cache must keep those accounts separate.
```

The second segment supports a candidate account-pricing rule. The existing Alpha → Beta check provides execution evidence. The demo drawer should explain: **“This commit violates the account-pricing decision from this conversation.”** This makes business provenance visible without building a recorder into Canonical.

## Slice 2: one Fathom connection, explicit pull

Only required user setup: create a Fathom account, configure its recorder, capture an intended test conversation with the participants aware, and generate an API key under User Settings → API Access. The key is scoped to meetings the user can access. [Fathom quickstart](https://developers.fathom.ai/quickstart)

Keep provider code in `integrations/fathom.ts`, following the existing sponsor-adapter layout. Use built-in `fetch`, a fixed provider origin, bounded requests, and Zod response validation. The first adapter needs only:

| Operation | API request | Canonical behavior |
|---|---|---|
| List recent recordings | `GET https://api.fathom.ai/external/v1/meetings` | Display title/date and retain `recording_id`, source URL, and meeting metadata. Follow `next_cursor` only when the user requests more. |
| Import selected recording | `GET https://api.fathom.ai/external/v1/recordings/{recording_id}/transcript` | Normalize returned speaker, text, and timestamp into the same import pipeline. Omit `destination_url` to receive the response directly. |

Send `X-Api-Key` from the backend only. The transcript endpoint's response format and synchronous behavior are documented in the [get-transcript reference](https://developers.fathom.ai/api-reference/recordings/get-transcript). The meeting list and authentication are documented in the [quickstart](https://developers.fathom.ai/quickstart).

Add a server-side `FATHOM_API_KEY` configuration entry when implementing this slice. This is a personal meeting-data API key; an organization administration/management token is not needed. It is also unrelated to Daytona credentials or SurrealDB database authentication. No OAuth app registration or public webhook endpoint is needed for this single-team pull. Public distribution to other users would require an OAuth connection flow.

Handle “not processed yet,” expired/invalid credentials, absent meeting access, pagination, and rate limits explicitly. Preserve the original imported version if a later fetch differs. Do not interpret missing transcripts as an empty conversation or generate rules from an unavailable source. A paste fallback remains available.

## Slice 3: automatic ingestion only after the pull works

Add a Fathom webhook when there is a stable backend URL. Configure it for the intended recording scope and route incoming content through the same importer. Verify the signature using the raw request body and signing secret before accepting the event, apply timestamp tolerance, and deduplicate delivery IDs. [Webhook verification](https://developers.fathom.ai/webhooks)

Fathom sends new-content webhooks after a recording finalizes; processing time has no guaranteed delivery window. Later transcript/visibility changes do not emit another event, so a refresh remains useful. Very short test recordings may produce no summary and no webhook. [Webhook behavior](https://developers.fathom.ai/faq)

Avoid a streaming transcript UI for the first demonstration. The valuable live update is an approved rule acquiring new commit evidence in SurrealDB. Meeting capture can finish before the commit review begins.

## Shared contract and storage shape

These are proposed additions, not existing API fields:

| Entity | Required shape / invariants |
|---|---|
| `context_source` | Project ID, provider/type, external ID when present, title, original text, content hash, import timestamp, optional meeting timestamp/source URL, explicit synthetic flag. |
| `context_segment` | Source ID, index, verbatim text; optional speaker and relative start/end timestamp; line/character offsets for plain-text imports. Do not fabricate timestamps or speaker identities. |
| `requirement_proposal` | Project ID, proposed text, supporting segment IDs and exact quote spans, status (`proposed`, `accepted`, `rejected`, `conflict`), extractor/version, suggested concept/check mapping. |
| Requirement version | Stable rule key, approved text, version, source/proposal references, reviewer, approval time, applicable scope, optional superseded version. |

Suggested SurrealDB edges:

```text
context_source -> contains -> context_segment
requirement_proposal -> supported_by -> context_segment
requirement_version -> adopted_from -> requirement_proposal
requirement_version -> constrains -> concept
evidence -> validates -> requirement_version
new_requirement_version -> supersedes -> old_requirement_version
```

Keep project boundaries on every read and write. Store raw transcripts in the context store, not the test sandboxes. Export the approved rule and minimal relevant excerpts, not entire calls. CI consumes an approved requirements snapshot and records its hash/version with the run; it should not fetch changing meeting transcripts or need a listener API key on every commit.

A new conversation can propose a change, but cannot silently overwrite an approved requirement or make a failing commit pass. Conflicting statements remain visible until resolved. Transcript text is evidence to interpret, not executable instructions to the agent or runner. Exact citation validation proves the quote exists; approval establishes which business rule the team intends to enforce.

## Work boundaries and acceptance

The UI teammate can build an import panel, proposed-rule cards, and a quote drawer using fixture `context_source`/`requirement_proposal` objects. Backend work owns normalization, validation, immutable source storage, approval versioning, and the future Fathom adapter. Agree these schemas in `packages/contracts` before changing existing report consumers.

Acceptance cases for the first slice:

- Import → review → approval → graph/source drawer works without provider credentials.
- Reimporting identical content is idempotent; altered content retains the old evidence.
- Missing timestamps remain unknown; quoted spans resolve to the stored original.
- Conflicting proposals never replace approved requirements automatically.
- A failed check links to the exact approved requirement version and its source quote.
- The exported context carries approved provenance; unreviewed suggestions remain visibly unapproved.

The listener integration is scoped here only. Implement the transcript import slice after the real repository/CI comparison is usable, then add Fathom pull if automated capture improves the next demo.

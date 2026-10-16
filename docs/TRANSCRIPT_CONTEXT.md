# Import and review business context

Use this slice to attach a transcript or notes to an existing completed review,
quote a source passage, and have a person associate it with an existing approved
requirement. No transcription provider, meeting bot, model key, or automated AI
extraction is required. Paste text from your preferred meeting tool or use the
explicitly synthetic pricing discussion for the demo.

## Review flow

1. Open a completed or failed Canonical run. Context belongs to that run only.
2. Import text with a title and its correct provenance: `transcript`, `notes`, or
   `synthetic`. An optional HTTP(S) source URL points back to the original material.
3. Select a source segment and copy an exact quotation from it. Choose an existing
   requirement and explain why the passage supports that requirement.
4. Review the proposal. Accept it as supporting context, reject it, or mark it as a
   conflict that needs resolution. The review records a reviewer and optional note.
5. Download the run's agent context. Accepted quotations and their citations are
   included alongside the original execution evidence. Rejected and conflicted
   proposals remain visible in the review workspace and are omitted from the export.

An accepted mapping is retrospective supporting context. It is **not** evidence
that the imported conversation was available to the earlier CI evaluation. It does
not change the executed checks, their outcomes, the baseline business policy, or
the original report. To change executable policy, review and commit that policy
in the target repository, then run a new comparison.

## Citations and approval rules

Original imported text is preserved. Sources record a SHA-256 content hash and
import time; segments record line numbers and character offsets into that source,
plus timestamps and speaker information when supplied and recognized. Quotations
must be exact substrings of the selected segment. Invented or rewritten quotations
are rejected.

Imports with identical text after line-ending normalization and the same source
kind deduplicate within a run. Changing only the title does not replace the first
source. The same text imported into another run remains independent. Each run can
hold up to eight sources and 100 proposals; each source accepts up to 100,000 text
characters and 1,000 nonempty segments.

A proposal snapshots the existing requirement text and concept IDs. Acceptance
creates one immutable version-1 mapping for that requirement in that run. Another
acceptance cannot overwrite it. Accepted, rejected, and conflict decisions are
terminal; conflicting business claims need a deliberate policy change and another
run, rather than relabeling a failed check as successful.

## HTTP interface

All context endpoints are under `/api/runs/:id/business-context`:

| Method and suffix | Body or result |
| --- | --- |
| `GET` | Current workspace: sources, proposals, approvals, revision |
| `POST /sources` | `{title, kind, text, sourceUrl?}` |
| `POST /proposals` | `{sourceId, segmentId, quote, requirementId, rationale}` |
| `POST /proposals/:proposalId/review` | `{decision, reviewer, note?}` |

Successful writes return the complete updated workspace. New sources and proposals
return `201`; duplicate imports and review decisions return `200`. Unknown runs or
proposals return `404`; invalid inputs, including source or segment references
outside the current run, return `400`. Conflicts
or attempts to write to a running/queued review return `409`. Source imports have
a 512 KiB HTTP body limit in addition to the character limit.

The existing `GET /api/runs/:id/context` endpoint downloads Markdown including
accepted context. It continues to report original failed checks unchanged.

## Suggested synthetic demo

Import this text as `synthetic`:

```text
[00:12] Maya: Alpha is wholesale and pays $80 per unit.
[00:24] Leo: Beta is retail and pays $100 per unit.
[00:39] Maya: A previous customer's quote must not determine another account's price.
```

Map the exact quotation `Beta is retail and pays $100 per unit.` to
`account-price`, accept it, and export context. The original candidate failure
should still show Beta receiving $80, now accompanied by a reviewed citation
explaining why that outcome violates the existing pricing requirement.

Importing text requires no new meeting-product integration. Provider ingestion,
automatic transcript extraction, generated requirements, and publishing policy
changes to another repository are separate future slices.

## Persistence and graph-backed evidence

`CANONICAL_STORE=memory` keeps this workspace only for the current API process.
`CANONICAL_STORE=surreal` stores the workspace and its revision alongside native
source, segment, proposal, and approved-requirement records. The API reads approved
citations by traversing `adopted_from`, `supported_by`, and `contains` relationships;
it does not substitute an embedded quote when a graph path is missing. Approval
records also link to the run and its business concepts.

A revision check and graph updates share one transaction. Concurrent changes
cannot silently replace an approval. Local validation covers competing SDK
connections, stale writes, rollback, and isolation between runs.

`npm run check` covers the domain/API behavior. `npm run test:surreal:context`
runs the opt-in real database test when `SURREAL_URL`, `SURREAL_USERNAME`, and
`SURREAL_PASSWORD` are explicitly supplied in the environment. This test does
not load `.env`; use a local test server with root credentials. It creates and
removes an isolated test database under `canonical_context_checks`.

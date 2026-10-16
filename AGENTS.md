# Working together on Canonical

## Pull frequently

This repository has two people and multiple agents working concurrently. Keep your checkout current throughout a task.

- Before starting work, run `git status --short` and `git fetch origin`. If your working tree is clean and your branch has an upstream, run `git pull --ff-only`.
- Repeat that sync at each meaningful checkpoint: before starting a new vertical slice, before changing shared contracts or integrations, and before committing, pushing, or handing work back. During longer tasks, check for remote changes regularly instead of waiting until the end.
- If you have uncommitted work, fetch immediately, then finish and commit your own coherent changes before pulling. Never discard, overwrite, or automatically stash someone else's edits just to sync.
- If `git pull --ff-only` cannot advance your branch, inspect the divergence and integrate the relevant upstream changes deliberately. Do not force-push, reset away work, or blindly resolve conflicts.
- On a feature branch, also inspect changes on `origin/main` and incorporate shared contract or integration updates before building against stale assumptions. Fetching alone does not update your working files.
- Agents sharing one working tree must coordinate Git mutations. Nominate one agent to pull, commit, and push; other agents report changes to that owner rather than running competing Git operations.

## Ownership and vertical slices

- UI work lives in `apps/ui/`; backend work lives in `apps/api/`, `packages/runner/`, and `integrations/`.
- `packages/contracts/` is the UI/backend boundary. Coordinate schema changes and keep both consumers compatible.
- Delegate independent work to sub-agents when it speeds delivery. Give each agent explicit file ownership and avoid overlapping edits.
- Complete a working vertical slice before expanding scope. Keep fixture data, inferred claims, approved business intent, and executed evidence clearly distinguished.
- Read the existing implementation and relevant documentation before changing integrations. Keep provider SDK calls in accessible integration modules.

## Validation and handoff

- Run checks appropriate to the change. `npm run check` covers type checking, tests, and the UI build. Validate real integrations when their behavior changes and credentials are available.
- Never commit `.env`, API keys, database credentials, or downloaded private conversation data. Keep generated reports under ignored `.canonical/output/`.
- Commit coherent, tested changes promptly so the other builder can pull them. Report the commit, what works, what was verified, and any unfinished integration.
- Never claim a demo, provider connection, or hosted CI run succeeded without checking its actual result.

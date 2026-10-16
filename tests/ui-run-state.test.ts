import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRun, createUiFixture } from '@canonical/demo';
import { initialReview } from '../packages/runner/src/review-pipeline.ts';
import { mergeRunSnapshots, newlyDiscoveredRun } from '../apps/ui/src/lib/run-state.ts';

test('delayed queued POST cannot replace a completed SSE report, including timestamp ties', () => {
  const completed = createUiFixture();
  const queued = { ...createRun(completed.id, 'local'), createdAt: completed.createdAt, updatedAt: completed.updatedAt };
  assert.equal(mergeRunSnapshots([completed], [queued])[0], completed);
  queued.updatedAt = '2020-01-01T00:00:00.000Z';
  assert.equal(mergeRunSnapshots([completed], [queued])[0], completed);
});

test('stale list cannot remove a newly pushed run or regress its review sequence', () => {
  const original = createRun('older-report', 'local');
  original.createdAt = '2020-01-01T00:00:00.000Z';
  const current = createRun('new-ci-report', 'daytona');
  current.review = initialReview(current, 'static-analysis');
  current.review.sequence = 12;
  const stale = structuredClone(current);
  stale.review!.sequence = 2;
  stale.updatedAt = '2099-01-01T00:00:00.000Z';
  const merged = mergeRunSnapshots([current, original], [original]);
  assert.equal(merged[0], current);
  assert.equal(mergeRunSnapshots(merged, [stale])[0], current);
});

test('newer running snapshots are accepted by review sequence and legacy updatedAt', () => {
  const queued = createRun('active-review', 'daytona');
  queued.review = initialReview(queued, 'static-analysis');
  queued.review.sequence = 1;
  const running = structuredClone(queued);
  running.status = 'running'; running.review!.sequence = 2;
  running.updatedAt = '2020-01-01T00:00:00.000Z';
  assert.equal(mergeRunSnapshots([queued], [running])[0], running);
  const oldFixture = createRun('legacy-fixture', 'local');
  oldFixture.updatedAt = '2020-01-01T00:00:00.000Z';
  const freshFixture = { ...oldFixture, status: 'running' as const, stage: 'Evaluating candidate', updatedAt: '2020-01-01T00:00:01.000Z' };
  assert.equal(mergeRunSnapshots([oldFixture], [freshFixture])[0], freshFixture);
});

test('new-run focus happens once and remains suppressed on replay or history refresh', () => {
  const seen = new Set<string>();
  const existing = createRun('existing', 'local');
  existing.createdAt = '2020-01-01T00:00:00.000Z';
  newlyDiscoveredRun([existing], seen); // Initial HTTP history establishes known IDs.
  const incoming = createRun('new-ci', 'daytona');
  const merged = mergeRunSnapshots([existing], [incoming, existing]);
  assert.equal(newlyDiscoveredRun(merged, seen)?.id, incoming.id);
  assert.equal(newlyDiscoveredRun(merged, seen), undefined);
  newlyDiscoveredRun([existing], seen); // Older history never forgets discovery.
  assert.equal(newlyDiscoveredRun(merged, seen), undefined);
});

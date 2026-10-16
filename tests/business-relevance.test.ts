import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUiFixture } from '@canonical/demo';
import { businessEntries, businessRelevance } from '../apps/ui/src/lib/business-relevance.ts';
import type { MergedNode } from '../apps/ui/src/lib/review.ts';
const node = (label: string, properties: Record<string, string> = {}, excerpt = ''): MergedNode => ({
  id: label, change: 'modified', node: { id: label, label, kind: 'branch', description: 'in createQuoteService.quote', properties, citations: [] },
  after: { id: label, label, kind: 'branch', description: 'in createQuoteService.quote', properties,
    citations: excerpt ? [{ path: 'src/pricing.mjs', sha: 'a'.repeat(40), startLine: 1, endLine: 1, excerpt }] : [] },
});
test('quantity selection dims unrelated price checks even with a broad parent citation', () => {
  const selected = [node('Validate quote quantity', { condition: '!Number.isInteger(quantity)' }, 'async quote(account, sku, quantity) { const price = 80; }')];
  assert.equal(businessRelevance('positive-quantity', selected), 'relevant');
  assert.equal(businessRelevance('account-price', selected), 'unrelated');
  assert.equal(businessRelevance('repeat-price', selected), 'unrelated');
});
test('cache and counter scopes do not acquire relevance from incidental function names', () => {
  const cache = [node('Cache lookup', { key: 'sku' })];
  assert.equal(businessRelevance('account-price', cache), 'relevant');
  assert.equal(businessRelevance('repeat-price', cache), 'relevant');
  assert.equal(businessRelevance('positive-quantity', cache), 'unrelated');
  const counter = [node('createQuoteService.upstreamCalls', { parameters: '' }, 'get upstreamCalls() { return upstreamCalls; }'), node('Return counter', { value: 'upstreamCalls' }, 'return upstreamCalls;')];
  for (const id of ['account-price', 'repeat-price', 'positive-quantity']) assert.equal(businessRelevance(id, counter), 'unrelated');
  assert.equal(businessRelevance('new-policy', counter), 'unknown');
  assert.equal(businessRelevance('account-price', []), 'unknown');
});
test('recorded results remain authoritative and pending/error never become passed', () => {
  const run = createUiFixture();
  assert.equal(businessEntries(run)[0].status, 'failed');
  run.results = [];
  run.status = 'running';
  assert.ok(businessEntries(run).every(entry => entry.status === 'pending'));
  run.status = 'error';
  assert.ok(businessEntries(run).every(entry => entry.status === 'error'));
});

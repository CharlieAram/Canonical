import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtractedNode, SourceCitation } from '@canonical/contracts';
import { diffCitations, sourceDiff } from '../apps/ui/src/lib/source-diff.ts';

const citation = (excerpt: string, startLine = 1, path = 'src/pricing.mjs', sha = 'a'.repeat(40)): SourceCitation => ({
  path, sha, excerpt, startLine, endLine: startLine + Math.max(0, excerpt.split('\n').length - 1 - (excerpt.endsWith('\n') ? 1 : 0)),
});
const node = (...citations: SourceCitation[]): ExtractedNode => ({ id: 'cache', label: 'Cache', kind: 'collection', description: 'Pricing cache', properties: {}, citations });

test('modified cited source produces exact minus/plus lines with independent source offsets', () => {
  const before = citation('function price() {\n  return cache.get(sku);\n}', 10);
  const after = citation('function price() {\n  return cache.get(account + sku);\n}', 24, before.path, 'b'.repeat(40));
  const { lines } = diffCitations(before, after);
  assert.deepEqual(lines.map(({ kind, text, oldLine, newLine }) => ({ kind, text, oldLine, newLine })), [
    { kind: 'context', text: 'function price() {', oldLine: 10, newLine: 24 },
    { kind: 'remove', text: '  return cache.get(sku);', oldLine: 11, newLine: undefined },
    { kind: 'add', text: '  return cache.get(account + sku);', oldLine: undefined, newLine: 25 },
    { kind: 'context', text: '}', oldLine: 12, newLine: 26 },
  ]);
  const [file] = sourceDiff(node(before), node(after));
  assert.equal(file.unchanged, false);
  assert.deepEqual([file.hunks[0].oldStart, file.hunks[0].oldCount, file.hunks[0].newStart, file.hunks[0].newCount], [10, 3, 24, 3]);
});

test('added and removed citations retain missing-side provenance without inventing a removed file', () => {
  const value = citation('const cache = new Map();\ncache.set(key, price);', 44);
  const [added] = sourceDiff(undefined, node(value));
  assert.equal(added.before, undefined);
  assert.equal(added.after, value);
  assert.deepEqual(added.hunks[0].lines.map(line => [line.kind, line.oldLine, line.newLine]), [['add', undefined, 44], ['add', undefined, 45]]);
  assert.deepEqual([added.hunks[0].oldStart, added.hunks[0].oldCount], [0, 0]);
  const [removed] = sourceDiff(node(value), undefined);
  assert.equal(removed.after, undefined);
  assert.deepEqual(removed.hunks[0].lines.map(line => [line.kind, line.oldLine, line.newLine]), [['remove', 44, undefined], ['remove', 45, undefined]]);
});

test('identical source stays unchanged across different commits and source line locations', () => {
  const left = node(citation('cache.get(key);\nreturn price;', 2));
  const right = node(citation('cache.get(key);\nreturn price;', 90, 'src/pricing.mjs', 'b'.repeat(40)));
  left.properties = { key: 'sku' }; right.properties = { key: 'account, sku' };
  const [file] = sourceDiff(left, right);
  assert.equal(file.unchanged, true);
  assert.ok(file.hunks[0].lines.every(line => line.kind === 'context'));
  assert.deepEqual(file.hunks[0].lines.map(line => [line.oldLine, line.newLine]), [[2, 90], [3, 91]]);
});

test('multiple files remain separate and nested/duplicate citations do not duplicate source lines', () => {
  const whole = citation('function quote() {\n  const price = 80;\n  return price;\n}', 4);
  const nested = citation('return price;', 6);
  const other = citation('export const currency = "USD";', 12, 'src/currency.mjs');
  const files = sourceDiff(node(whole, whole, nested, other), node(whole, nested, other));
  assert.deepEqual(files.map(file => file.path), ['src/currency.mjs', 'src/pricing.mjs']);
  const pricing = files[1];
  assert.equal(pricing.before, whole);
  assert.equal(pricing.after, whole);
  assert.equal(pricing.otherCitations, 2);
  assert.equal(pricing.hunks[0].lines.length, 4);
});

test('disjoint citations remain separate coherent ranges without manufacturing combined code', () => {
  const tiny = citation('const cache = new Map();', 2);
  const wider = citation('if (cache.has(key)) {\n return cache.get(key);\n}', 100);
  const files = sourceDiff(node(tiny, wider), node(tiny, wider));
  assert.equal(files.length, 2);
  assert.equal(files[0].hunks[0].oldStart, 2);
  const file = files[1];
  assert.equal(file.hunks[0].oldStart, 100);
  assert.deepEqual(file.hunks[0].lines.map(line => line.text), wider.excerpt.split('\n'));
  assert.equal(file.otherCitations, 0);
});

test('distant edits produce context-three hunks with explicit omitted gaps and correct coordinates', () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  lines[0] = 'function quote() {';
  const changed = [...lines]; changed[4] = 'first change'; changed[22] = 'second change';
  const [file] = sourceDiff(node(citation(lines.join('\n'), 50)), node(citation(changed.join('\n'), 70)));
  assert.equal(file.hunks.length, 2);
  assert.deepEqual(file.hunks.map(hunk => [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]), [[51, 7, 71, 7], [69, 7, 89, 7]]);
  assert.equal(file.hunks[0].omittedBefore, 1);
  assert.equal(file.hunks[1].omittedBefore, 11);
  assert.equal(file.omittedAfter, 4);
});

test('missing newline is a real excerpt difference and never creates an invented trailing blank line', () => {
  const left = citation('return price;\n', 20), right = citation('return price;', 20);
  const { lines } = diffCitations(left, right);
  assert.deepEqual(lines.map(line => [line.kind, line.text, line.noNewline]), [['remove', 'return price;', false], ['add', 'return price;', true]]);
  assert.equal(diffCitations(citation('one\n'), citation('one\n')).lines.length, 1);
  assert.equal(diffCitations(citation('\n'), citation('\n')).lines.length, 1);
});

test('partial-line citations retain exact excerpt text and line positions without inventing surrounding source', () => {
  const files = sourceDiff(node(citation('sku', 8)), node(citation('account + sku', 8)));
  assert.ok(files.every(file => file.unpaired));
  const lines = files.flatMap(file => file.hunks.flatMap(hunk => hunk.lines));
  assert.deepEqual(lines.map(line => line.text), ['sku', 'account + sku']);
  assert.equal(lines[0].oldLine, 8);
  assert.equal(lines[1].newLine, 8);
  assert.ok(lines.every(line => line.noNewline));
});

test('large inputs are bounded and explicitly marked truncated', () => {
  const manyLines = Array.from({ length: 500 }, (_, index) => `line ${index}`).join('\n');
  const bounded = diffCitations(citation(manyLines), citation(manyLines.replaceAll('line', 'updated')));
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.lines.filter(line => line.oldLine !== undefined).length, 300);
  assert.equal(bounded.lines.filter(line => line.newLine !== undefined).length, 300);
  const [longLine] = sourceDiff(undefined, node(citation('x'.repeat(80_000))));
  assert.equal(longLine.truncated, true);
  assert.equal(longLine.hunks[0].lines[0].text.length, 40_000);
});

test('unchanged long excerpts show a short preview and explicit omitted context', () => {
  const value = citation(Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n'), 7);
  const [file] = sourceDiff(node(value), node(value));
  assert.equal(file.unchanged, true);
  assert.equal(file.hunks[0].lines.length, 6);
  assert.equal(file.omittedAfter, 14);
  assert.deepEqual(sourceDiff(), []);
});

test('matches unchanged counter evidence and preserves new cache evidence as a separate unpaired block', () => {
  const oldCounter = citation('upstreamCalls = 0', 4);
  const newCounter = citation('upstreamCalls = 0', 5, oldCounter.path, 'b'.repeat(40));
  const cache = citation('cache = new Map()', 4, oldCounter.path, 'b'.repeat(40));
  const files = sourceDiff(node(oldCounter), node(cache, newCounter));
  assert.equal(files.length, 2);
  assert.equal(files[0].before, oldCounter);
  assert.equal(files[0].after, newCounter);
  assert.equal(files[0].unchanged, true);
  assert.equal(files[1].after, cache);
  assert.equal(files[1].unpaired, true);
  assert.equal(files[1].before, undefined);
});

test('different declarations never become a fictional replacement even at identical line positions', () => {
  const files = sourceDiff(node(citation('upstreamCalls = 0', 4)), node(citation('cache = new Map()', 4)));
  assert.equal(files.length, 2);
  assert.ok(files.every(file => file.unpaired));
  assert.ok(files.every(file => !file.before || !file.after));
});

test('same declaration anchor pairs genuine changes and token matching preserves string whitespace', () => {
  const [paired] = sourceDiff(node(citation('const price = 80;', 4)), node(citation('const price = 100;', 9)));
  assert.ok(paired.before && paired.after);
  assert.equal(paired.unpaired, false);
  assert.deepEqual(paired.hunks[0].lines.map(line => line.kind), ['remove', 'add']);
  const [formatted] = sourceDiff(node(citation('cache.get( key );', 4)), node(citation('cache.get(key);', 9)));
  assert.ok(formatted.before && formatted.after);
  const distinct = sourceDiff(node(citation('"a b"', 4)), node(citation('"ab"', 4)));
  assert.equal(distinct.length, 2);
  assert.ok(distinct.every(file => file.unpaired));
});

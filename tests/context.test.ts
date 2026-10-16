import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ContextWorkspaceSchema, type ContextWorkspace } from '@canonical/contracts';
import { createUiFixture } from '@canonical/demo';
import { emptyContext, importContext, proposeContext, reviewContext } from '../packages/runner/src/business-context.ts';

const text = '[00:12] Maya: Alpha pays $80.\r\n[00:24] Leo: Beta pays $100.\r\n';
function sourceWorkspace(runId = 'ui-fixture') {
  return importContext(emptyContext(runId), { title: 'Synthetic pricing call', kind: 'synthetic', text });
}
function proposal(workspace: ContextWorkspace, requirementId = 'account-price') {
  const source = workspace.sources[0];
  const segment = source.segments.find(part => part.text.includes('Beta pays'))!;
  return {
    sourceId: source.id, segmentId: segment.id, quote: 'Beta pays $100.', requirementId,
    rationale: 'The speaker confirms the existing retail price requirement.',
  };
}
const status = (expected: number) => (error: unknown) =>
  typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === expected;

test('context imports preserve original source, citation offsets, and run boundaries', () => {
  const initial = emptyContext('ui-fixture');
  const workspace = importContext(initial, { title: 'Synthetic pricing call', kind: 'synthetic', text });
  ContextWorkspaceSchema.parse(workspace);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.sources, []);
  assert.equal(workspace.revision, 1);
  const source = workspace.sources[0];
  assert.equal(source.text, text);
  assert.equal(source.runId, 'ui-fixture');
  assert.match(source.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(source.segments.length >= 2);
  for (const segment of source.segments) {
    assert.equal(text.slice(segment.start, segment.end), segment.text);
    assert.equal(segment.line, text.slice(0, segment.start).split('\n').length);
  }
  assert.equal(source.segments.find(segment => segment.text.includes('Beta pays'))?.timestamp, '00:24');
  const independent = sourceWorkspace('different-run');
  assert.equal(independent.sources[0].runId, 'different-run');
  independent.sources[0].title = 'Independent edit';
  assert.equal(source.title, 'Synthetic pricing call');
});

test('normalized identical imports retain original title and source without incrementing revision', () => {
  const first = sourceWorkspace();
  const duplicate = importContext(first, { title: 'Changed title', kind: 'synthetic', text: text.replaceAll('\r\n', '\n') });
  assert.deepEqual(duplicate, first);
  assert.equal(duplicate.sources[0].title, 'Synthetic pricing call');
  const differentKind = importContext(first, { title: 'Notes', kind: 'notes', text });
  assert.equal(differentKind.sources.length, 2);
  assert.equal(differentKind.revision, 2);
  // Hash reflects normalized content, rather than title or provenance metadata.
  assert.equal(first.sources[0].contentHash, createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex'));
});

test('proposals require an exact quote from the chosen source segment and an existing rule', () => {
  const run = createUiFixture();
  const workspace = sourceWorkspace();
  for (const change of [
    { quote: 'Beta pays $80.' }, { quote: 'Alpha pays $80.' },
    { sourceId: 'absent' }, { segmentId: 'absent' }, { requirementId: 'new-unchecked-rule' },
  ]) {
    assert.throws(() => proposeContext(workspace, run, { ...proposal(workspace), ...change }));
  }
  assert.deepEqual(workspace.proposals, []);
  const next = proposeContext(workspace, run, proposal(workspace));
  const proposed = next.proposals[0];
  const rule = run.requirements.find(item => item.id === 'account-price')!;
  assert.equal(proposed.requirementText, rule.text);
  assert.deepEqual(proposed.conceptIds, rule.conceptIds);
  assert.equal(proposed.method, 'manual');
  assert.equal(proposed.status, 'proposed');
  assert.equal(next.revision, 2);
});

test('approvals snapshot approved rule and citation without changing executed evidence', () => {
  const run = createUiFixture();
  const before = structuredClone(run);
  const imported = sourceWorkspace();
  const proposed = proposeContext(imported, run, proposal(imported));
  const approved = reviewContext(proposed, run, proposed.proposals[0].id, {
    decision: 'accepted', reviewer: 'Demo reviewer', note: 'Matches approved retail policy.',
  });
  ContextWorkspaceSchema.parse(approved);
  assert.deepEqual(run, before);
  assert.equal(proposed.proposals[0].status, 'proposed');
  assert.equal(proposed.approvals.length, 0);
  assert.equal(approved.revision, 3);
  const citation = approved.approvals[0];
  assert.equal(citation.version, 1);
  assert.equal(citation.association, 'reviewed-context');
  assert.equal(citation.quote, 'Beta pays $100.');
  assert.equal(citation.source.contentHash, imported.sources[0].contentHash);
  assert.equal(citation.segment.id, proposed.proposals[0].segmentId);
  assert.equal(citation.requirementText, before.requirements[0].text);
  assert.deepEqual(citation.conceptIds, before.requirements[0].conceptIds);
  assert.equal(approved.proposals[0].status, 'accepted');
  assert.throws(() => reviewContext(approved, run, proposed.proposals[0].id, {
    decision: 'rejected', reviewer: 'Another reviewer', note: '',
  }), status(409));
});

test('reject and conflict are terminal decisions and cannot become supporting evidence', () => {
  const run = createUiFixture();
  for (const decision of ['rejected', 'conflict'] as const) {
    const imported = sourceWorkspace();
    const proposed = proposeContext(imported, run, proposal(imported));
    const reviewed = reviewContext(proposed, run, proposed.proposals[0].id, {
      decision, reviewer: 'Reviewer', note: 'Source does not establish this policy.',
    });
    assert.deepEqual(reviewed.approvals, []);
    assert.equal(reviewed.proposals[0].status, decision);
    assert.throws(() => reviewContext(reviewed, run, proposed.proposals[0].id, {
      decision: 'accepted', reviewer: 'Reviewer', note: '',
    }), status(409));
  }
});

test('a second approval cannot overwrite the first mapping for an existing requirement', () => {
  const run = createUiFixture();
  const imported = sourceWorkspace();
  let workspace = proposeContext(imported, run, proposal(imported));
  workspace = proposeContext(workspace, run, { ...proposal(imported), rationale: 'Independent manual proposal.' });
  workspace = reviewContext(workspace, run, workspace.proposals[0].id, {
    decision: 'accepted', reviewer: 'First reviewer', note: '',
  });
  const before = structuredClone(workspace);
  assert.throws(() => reviewContext(workspace, run, workspace.proposals[1].id, {
    decision: 'accepted', reviewer: 'Second reviewer', note: '',
  }), status(409));
  assert.deepEqual(workspace, before);
  assert.equal(workspace.approvals.length, 1);
});

test('context limits reject additional sources and proposals without mutating saved state', () => {
  const run = createUiFixture();
  let workspace = emptyContext(run.id);
  for (let index = 0; index < 8; index++) {
    workspace = importContext(workspace, { title: `Source ${index}`, kind: 'synthetic', text: `${text}Note ${index}` });
  }
  assert.throws(() => importContext(workspace, { title: 'Extra', kind: 'notes', text: 'Extra source' }));
  for (let index = 0; index < 100; index++) {
    workspace = proposeContext(workspace, run, { ...proposal(workspace), rationale: `Mapping ${index}` });
  }
  assert.throws(() => proposeContext(workspace, run, proposal(workspace)));
  assert.equal(workspace.sources.length, 8);
  assert.equal(workspace.proposals.length, 100);
});

test('review refuses requirement changes and mismatched run identity after a proposal', () => {
  const run = createUiFixture();
  const imported = sourceWorkspace();
  const proposed = proposeContext(imported, run, proposal(imported));
  const review = { decision: 'accepted' as const, reviewer: 'Reviewer', note: '' };
  for (const change of ['text', 'concepts', 'run'] as const) {
    const changed = structuredClone(run);
    if (change === 'text') changed.requirements[0].text = 'Any price is acceptable.';
    else if (change === 'concepts') changed.requirements[0].conceptIds = [];
    else changed.id = 'different-run';
    assert.throws(() => reviewContext(proposed, changed, proposed.proposals[0].id, review), status(409));
  }
  assert.equal(proposed.proposals[0].status, 'proposed');
  assert.deepEqual(proposed.approvals, []);
});

test('WebVTT cues retain timestamps and exact source offsets for quoted speech', () => {
  const vtt = 'WEBVTT\n\n00:00:12.000 --> 00:00:15.000\n<v Maya>Beta pays $100.\n';
  const workspace = importContext(emptyContext('vtt-run'), { title: 'Synthetic captions', kind: 'synthetic', text: vtt });
  assert.equal(workspace.sources[0].segments.length, 1);
  const segment = workspace.sources[0].segments[0];
  assert.equal(segment.timestamp, '00:00:12.000');
  assert.equal(segment.speaker, 'Maya');
  assert.equal(segment.line, 4);
  assert.equal(vtt.slice(segment.start, segment.end), '<v Maya>Beta pays $100.');
});


test('segment limits bound graph size and timestamps do not leak across VTT cues', () => {
  assert.throws(() => importContext(emptyContext('bounded'), {
    title: 'Many lines', kind: 'notes', text: Array.from({ length: 1001 }, () => 'Line').join('\n'),
  }), /1,000/);
  const workspace = importContext(emptyContext('timestamps'), {
    title: 'Captions with note', kind: 'transcript',
    text: 'WEBVTT\n\n00:00:12.000 --> 00:00:15.000\nA spoken line.\n\nUntimed note.',
  });
  assert.equal(workspace.sources[0].segments[0].timestamp, '00:00:12.000');
  assert.equal(workspace.sources[0].segments[1].timestamp, undefined);
});

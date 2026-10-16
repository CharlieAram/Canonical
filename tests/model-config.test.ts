import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../apps/api/src/config.ts';

test('default and blank-key configuration keep local fixtures and static extraction available', () => {
  for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: ' \t ' }]) {
    const config = readConfig(env);
    assert.deepEqual(config.extraction, { mode: 'static' });
    assert.equal(config.openai, undefined);
    assert.equal(config.daytona, undefined);
    assert.equal(config.storage, 'memory');
  }
});

test('auto selects real OpenAI extraction when a key exists and preserves the selected model', () => {
  const config = readConfig({ OPENAI_API_KEY: 'test-key-never-sent' });
  assert.deepEqual(config.extraction, { mode: 'openai' });
  assert.deepEqual(config.openai, { apiKey: 'test-key-never-sent', model: 'gpt-5.4-mini' });
  const custom = readConfig({ CANONICAL_EXTRACTION: 'auto', OPENAI_API_KEY: 'test-key-never-sent', OPENAI_MODEL: 'explicit-model-id' });
  assert.equal(custom.openai?.model, 'explicit-model-id');
});

test('explicit static mode remains static with an available OpenAI key', () => {
  const config = readConfig({ CANONICAL_EXTRACTION: 'static', OPENAI_API_KEY: 'test-key-never-sent' });
  assert.deepEqual(config.extraction, { mode: 'static' });
  assert.equal(config.openai?.model, 'gpt-5.4-mini');
});

test('explicit OpenAI mode requires a nonempty key before any provider work', () => {
  for (const OPENAI_API_KEY of [undefined, '', '   ']) {
    assert.throws(() => readConfig({ CANONICAL_EXTRACTION: 'openai', OPENAI_API_KEY }),
      /OPENAI_API_KEY is required when CANONICAL_EXTRACTION=openai/);
  }
  assert.equal(readConfig({ CANONICAL_EXTRACTION: 'openai', OPENAI_API_KEY: 'test-key-never-sent' }).extraction.mode, 'openai');
});

test('invalid extraction configuration reports variable names without credential values', () => {
  for (const invalid of [{ CANONICAL_EXTRACTION: 'secret-invalid-mode' }, { OPENAI_MODEL: '   ' }]) {
    assert.throws(() => readConfig({ ...invalid, OPENAI_API_KEY: 'test-secret-not-for-output', SURREAL_PASSWORD: 'test-database-secret' }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid configuration: (CANONICAL_EXTRACTION|OPENAI_MODEL)/);
      assert.doesNotMatch(error.message, /test-secret|test-database-secret|secret-invalid-mode/);
      return true;
    });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAIRequestError, requestStructured, type OpenAIErrorCode } from '../integrations/openai.ts';

const config = { apiKey: 'test-key-never-log', model: 'gpt-5-mini' };
const request = {
  name: 'source_layer', instructions: 'Extract source facts as JSON.', input: 'const cache = new Map();',
  schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
};
const completed = (overrides: Record<string, unknown> = {}) => ({
  id: 'resp_test_123', status: 'completed', model: 'gpt-5-mini-2025-08-07',
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"label":"Cache"}' }] }],
  usage: { input_tokens: 120, output_tokens: 25 }, ...overrides,
});
const returning = (value: unknown): typeof fetch => async () => Response.json(value);
const safeError = (code: OpenAIErrorCode, status?: number) => (error: unknown) => {
  assert.ok(error instanceof OpenAIRequestError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.doesNotMatch(`${error.message} ${error.stack} ${JSON.stringify(error)}`, /test-key-never-log|PRIVATE|Bearer/);
  assert.equal('cause' in error, false);
  return true;
};

test('OpenAI request uses strict Responses JSON schema and keeps credentials only in the auth header', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${config.apiKey}`);
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      model: 'gpt-5-mini', store: false, instructions: request.instructions, input: request.input,
      text: { format: { type: 'json_schema', name: request.name, schema: request.schema, strict: true } },
      reasoning: { effort: 'low' }, max_output_tokens: 10_000,
    });
    assert.doesNotMatch(String(init?.body), /test-key-never-log/);
    return Response.json(completed());
  };
  assert.deepEqual(await requestStructured(config, request, fetchImpl), {
    data: { label: 'Cache' }, responseId: 'resp_test_123', model: 'gpt-5-mini-2025-08-07', inputTokens: 120, outputTokens: 25,
  });
  assert.equal(calls, 1);
});

test('parser accepts only assistant message output_text and joins its content chunks', async () => {
  const response = await requestStructured(config, request, returning(completed({
    output_text: 'PRIVATE: not the raw wire response field',
    output: [
      { type: 'reasoning', content: [{ type: 'output_text', text: 'not JSON' }] },
      { type: 'function_call', arguments: 'not JSON' },
      { type: 'message', role: 'assistant', status: 'completed', content: [
        { type: 'output_text', text: '{"label":' }, { type: 'output_text', text: '"Cache"}' },
      ] },
    ],
    usage: { input_tokens: -1, output_tokens: 'PRIVATE' },
  })));
  assert.deepEqual(response.data, { label: 'Cache' });
  assert.equal(response.inputTokens, undefined);
  assert.equal(response.outputTokens, undefined);
});

test('HTTP and network failures redact provider bodies and do not retry authentication or schema errors', async () => {
  for (const status of [400, 401, 429, 500]) {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts++;
      return new Response('PRIVATE prompt; Bearer test-key-never-log', { status });
    };
    await assert.rejects(requestStructured(config, request, fetchImpl), safeError('http', status));
    assert.equal(attempts, 1);
  }
  await assert.rejects(requestStructured(config, request, async () => {
    throw new Error('PRIVATE network details Bearer test-key-never-log');
  }), safeError('network'));
});

test('refusal, incomplete and malformed outputs remain distinct safe failures', async () => {
  await assert.rejects(requestStructured(config, request, returning(completed({ output: [{
    type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'PRIVATE refusal details' }],
  }] }))), safeError('refusal'));
  await assert.rejects(requestStructured(config, request, returning(completed({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens', secret: 'PRIVATE' },
  }))), safeError('incomplete'));
  for (const value of [null, completed({ id: 'PRIVATE invalid id' }), completed({ model: 'gpt-4o' }),
    completed({ output: [] }), completed({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'PRIVATE invalid JSON' }] }] })]) {
    await assert.rejects(requestStructured(config, request, returning(value)), safeError('invalid-response'));
  }
  await assert.rejects(requestStructured(config, request, async () => new Response('PRIVATE malformed body', { status: 200 })), safeError('invalid-response'));
});

test('deadline aborts a pending request and bounds response-body parsing too', async () => {
  let signal: AbortSignal | null | undefined;
  const neverReturns: typeof fetch = async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  };
  await assert.rejects(requestStructured({ ...config, timeoutMs: 10 }, request, neverReturns), safeError('timeout'));
  assert.equal(signal?.aborted, true);
  const delayedBody: typeof fetch = async () => new Response(new ReadableStream({ start() {} }));
  await assert.rejects(requestStructured({ ...config, timeoutMs: 10 }, request, delayedBody), safeError('timeout'));
});

test('invalid configuration fails before network access and non-GPT5 models omit reasoning', async () => {
  let attempts = 0;
  const noFetch: typeof fetch = async () => { attempts++; return Response.json(completed()); };
  await assert.rejects(requestStructured({ ...config, apiKey: '' }, request, noFetch), safeError('configuration'));
  await assert.rejects(requestStructured({ ...config, timeoutMs: 0 }, request, noFetch), safeError('configuration'));
  await assert.rejects(requestStructured(config, { ...request, name: 'invalid schema name' }, noFetch), safeError('configuration'));
  assert.equal(attempts, 0);
  await requestStructured({ ...config, model: 'gpt-4o' }, request, async (_url, init) => {
    assert.equal('reasoning' in JSON.parse(String(init?.body)), false);
    return Response.json(completed({ model: 'gpt-4o-2024-08-06' }));
  });
});

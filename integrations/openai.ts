// Official Responses / structured output documentation:
// https://developers.openai.com/api/docs/guides/structured-outputs
// https://developers.openai.com/api/docs/models/gpt-5-mini
// Server-only integration. Provider response bodies and credentials never enter errors.
export interface OpenAIConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface StructuredRequest {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
}

export interface StructuredResponse {
  data: unknown;
  responseId: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type OpenAIErrorCode = 'configuration' | 'http' | 'network' | 'timeout' | 'refusal' | 'incomplete' | 'invalid-response';

const messages: Record<OpenAIErrorCode, string> = {
  configuration: 'OpenAI configuration or structured request is invalid.',
  http: 'OpenAI request failed.',
  network: 'OpenAI request could not reach the service.',
  timeout: 'OpenAI request exceeded its time limit.',
  refusal: 'OpenAI declined the structured extraction request.',
  incomplete: 'OpenAI did not complete the structured response.',
  'invalid-response': 'OpenAI returned an invalid structured response.',
};

export class OpenAIRequestError extends Error {
  constructor(readonly code: OpenAIErrorCode, readonly status?: number) {
    super(code === 'http' && status !== undefined ? `OpenAI request failed (HTTP ${status}).` : messages[code]);
    this.name = 'OpenAIRequestError';
  }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const modelName = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

function parseResponse(value: unknown, requestedModel: string): StructuredResponse {
  if (!object(value)) throw new OpenAIRequestError('invalid-response');
  if (['incomplete', 'failed', 'cancelled', 'queued', 'in_progress'].includes(String(value.status))) {
    throw new OpenAIRequestError('incomplete');
  }
  if (value.status !== 'completed' || typeof value.id !== 'string' || !/^resp_[a-zA-Z0-9_-]{1,200}$/.test(value.id) ||
      typeof value.model !== 'string' || !modelName.test(value.model) ||
      !(value.model === requestedModel || value.model.startsWith(`${requestedModel}-`)) || !Array.isArray(value.output)) {
    throw new OpenAIRequestError('invalid-response');
  }
  const chunks: string[] = [];
  for (const item of value.output) {
    if (!object(item) || item.type !== 'message' || item.role !== 'assistant') continue;
    if (item.status !== undefined && item.status !== 'completed') throw new OpenAIRequestError('incomplete');
    if (!Array.isArray(item.content)) throw new OpenAIRequestError('invalid-response');
    for (const part of item.content) {
      if (!object(part)) throw new OpenAIRequestError('invalid-response');
      if (part.type === 'refusal') throw new OpenAIRequestError('refusal');
      if (part.type === 'output_text') {
        if (typeof part.text !== 'string') throw new OpenAIRequestError('invalid-response');
        chunks.push(part.text);
      }
    }
  }
  if (!chunks.length) throw new OpenAIRequestError('invalid-response');
  let data: unknown;
  try { data = JSON.parse(chunks.join('')); }
  catch { throw new OpenAIRequestError('invalid-response'); }
  const usage = object(value.usage) ? value.usage : {};
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  return {
    data, responseId: value.id, model: value.model,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

// The caller validates `data` against its domain schema and checks source citations.
// No automatic retry: one agent invocation makes at most one billable API request.
export async function requestStructured(
  config: OpenAIConfig, request: StructuredRequest, fetchImpl: typeof fetch = fetch,
): Promise<StructuredResponse> {
  const timeoutMs = Math.min(config.timeoutMs ?? 120_000, 120_000);
  if (!config.apiKey?.trim() || !modelName.test(config.model) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(request.name) || !object(request.schema) ||
      typeof request.instructions !== 'string' || typeof request.input !== 'string') {
    throw new OpenAIRequestError('configuration');
  }
  let body: string;
  try {
    body = JSON.stringify({
      model: config.model, store: false,
      instructions: request.instructions, input: request.input,
      text: { format: { type: 'json_schema', name: request.name, schema: request.schema, strict: true } },
      ...(/^gpt-5(?:[.-]|$)/.test(config.model) ? { reasoning: { effort: 'low' } } : {}),
      max_output_tokens: 10_000,
    });
  } catch { throw new OpenAIRequestError('configuration'); }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new OpenAIRequestError('timeout')); }, timeoutMs);
  });
  const perform = async () => {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      // Do not consume an error body: it can echo secrets or private input.
      void response.body?.cancel().catch(() => {});
      throw new OpenAIRequestError('http', response.status);
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new OpenAIRequestError(controller.signal.aborted ? 'timeout' : 'invalid-response'); }
    return parseResponse(value, config.model);
  };
  try { return await Promise.race([perform(), deadline]); }
  catch (error) {
    if (controller.signal.aborted) throw new OpenAIRequestError('timeout');
    if (error instanceof OpenAIRequestError) throw error;
    throw new OpenAIRequestError('network');
  } finally { if (timer) clearTimeout(timer); }
}

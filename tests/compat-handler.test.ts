import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCompatSearch } from '../src/lib/agents/search/compatHandler.ts';
import { ModelNotConfiguredError } from '../src/lib/models/defaultModels.ts';
import { SearxngUnavailableError } from '../src/lib/searxngError.ts';

const request = () =>
  new Request(
    'http://localhost/search?q=winggo&format=json&language=ko&optimizationMode=speed',
  );

const models = {
  chatModel: { providerId: 'p', key: 'chat' },
  embeddingModel: { providerId: 'p', key: 'embed' },
};

test('returns the extended response and forwards the request signal', async () => {
  let receivedSignal: AbortSignal | undefined;
  const response = await handleCompatSearch(request(), {
    getModels: async () => models,
    runSearch: async (input, signal) => {
      receivedSignal = signal;
      assert.equal(input.config.widgetsEnabled, false);
      assert.equal(input.config.searchOptions?.language, 'ko');
      return { message: 'answer', sources: [] };
    },
    createRequestId: () => 'request-1',
    now: () => 100,
  });

  assert.equal(response.status, 200);
  assert.equal(receivedSignal instanceof AbortSignal, true);
  assert.deepEqual(await response.json(), {
    query: 'winggo',
    optimizationMode: 'speed',
    answer: 'answer',
    results: [],
    meta: { requestId: 'request-1', elapsedMs: 0 },
  });
});

test('maps model and SearXNG failures to stable error responses', async () => {
  const modelResponse = await handleCompatSearch(request(), {
    getModels: async () => {
      throw new ModelNotConfiguredError();
    },
    runSearch: async () => ({ message: '', sources: [] }),
    createRequestId: () => 'model-request',
  });
  assert.equal(modelResponse.status, 503);
  assert.equal((await modelResponse.json()).error.code, 'model_not_configured');

  const searxResponse = await handleCompatSearch(request(), {
    getModels: async () => models,
    runSearch: async () => {
      throw new SearxngUnavailableError('failed');
    },
    createRequestId: () => 'searx-request',
  });
  assert.equal(searxResponse.status, 502);
  assert.equal((await searxResponse.json()).error.code, 'searxng_unavailable');
});

test('maps a search deadline to search_timeout with a request ID', async () => {
  const response = await handleCompatSearch(request(), {
    getModels: async () => models,
    runSearch: async () => {
      throw new DOMException('deadline', 'TimeoutError');
    },
    createRequestId: () => 'timeout-request',
  });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    error: { code: 'search_timeout', message: 'AI search timed out.' },
    meta: { requestId: 'timeout-request' },
  });
});

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

test('aborting the original request aborts the search-service signal', async () => {
  const controller = new AbortController();
  const req = new Request(
    'http://localhost/search?q=winggo&optimizationMode=quality',
    { signal: controller.signal },
  );
  let receivedSignal: AbortSignal | undefined;
  let markSearchStarted!: () => void;
  const searchStarted = new Promise<void>((resolve) => {
    markSearchStarted = resolve;
  });

  const responsePromise = handleCompatSearch(req, {
    getModels: async () => models,
    runSearch: async (_input, signal) => {
      receivedSignal = signal;
      markSearchStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
    createRequestId: () => 'aborted-request',
  });

  await searchStarted;
  controller.abort(new DOMException('Client disconnected', 'AbortError'));
  const response = await responsePromise;

  assert.equal(receivedSignal?.aborted, true);
  assert.equal((receivedSignal?.reason as DOMException).name, 'AbortError');
  assert.equal(response.status, 502);
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

test('maps a deadline during model discovery to search_timeout', async () => {
  const controller = new AbortController();
  const req = new Request(
    'http://localhost/search?q=winggo&optimizationMode=speed',
    { signal: controller.signal },
  );
  let markDiscoveryStarted!: () => void;
  const discoveryStarted = new Promise<void>((resolve) => {
    markDiscoveryStarted = resolve;
  });

  const responsePromise = handleCompatSearch(req, {
    getModels: async (signal) => {
      markDiscoveryStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
    runSearch: async () => ({ message: '', sources: [] }),
    createRequestId: () => 'discovery-timeout-request',
  });

  await discoveryStarted;
  controller.abort(new DOMException('deadline', 'TimeoutError'));

  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'search_timeout');
});

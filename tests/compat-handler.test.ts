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
    citations: [],
    meta: { requestId: 'request-1', elapsedMs: 0, danglingCitations: [] },
  });
});

test('results-only requests search without loading a model', async () => {
  let modelsRequested = false;
  const searched: string[] = [];

  const response = await handleCompatSearch(
    new Request(
      'http://localhost/api/search/compat?q=아이유&sites=namu.wiki,brunch.co.kr',
    ),
    {
      getModels: async () => {
        modelsRequested = true;
        throw new Error('models must not be loaded in results-only mode');
      },
      searchSearxng: async (query) => {
        searched.push(query);
        const host = query.startsWith('site:namu.wiki')
          ? 'namu.wiki'
          : 'brunch.co.kr';

        return {
          results: [
            {
              title: `${host} 1`,
              url: `https://${host}/1`,
              content: 'a',
              publishedDate: '2024-03-01T00:00:00',
            },
            { title: `${host} 2`, url: `https://${host}/2`, content: 'b' },
            { title: 'off site', url: 'https://example.com/x', content: 'c' },
          ],
          // both fan-out queries hit the same throttled engine
          unresponsiveEngines: [['google', 'Suspended: too many requests']],
        };
      },
      runSearch: async () => {
        throw new Error('AI search must not run in results-only mode');
      },
      createRequestId: () => 'results-request',
      now: () => 0,
    },
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(modelsRequested, false);
  assert.deepEqual(searched, [
    'site:namu.wiki 아이유',
    'site:brunch.co.kr 아이유',
  ]);
  assert.ok(!('answer' in body));
  // reported once even though every fan-out query saw it
  assert.deepEqual(body.unresponsive_engines, [
    ['google', 'Suspended: too many requests'],
  ]);
  // one turn each, off-site rows dropped
  assert.deepEqual(
    body.results.map(
      (r: { url: string; publishedDate: string | null }) => ({
        url: r.url,
        publishedDate: r.publishedDate,
      }),
    ),
    [
      {
        url: 'https://namu.wiki/1',
        publishedDate: '2024-03-01T00:00:00',
      },
      {
        url: 'https://brunch.co.kr/1',
        publishedDate: '2024-03-01T00:00:00',
      },
      { url: 'https://namu.wiki/2', publishedDate: null },
      { url: 'https://brunch.co.kr/2', publishedDate: null },
    ],
  );
});

test('results-only search does not leak sites into SearXNG options', async () => {
  const calls: Array<{
    query: string;
    opts: Record<string, unknown> | undefined;
  }> = [];

  const response = await handleCompatSearch(
    new Request(
      'http://localhost/search?q=scope&sites=one.example,two.example&safesearch=2',
    ),
    {
      getModels: async () => {
        throw new Error('models must not be loaded');
      },
      searchSearxng: async (query, opts) => {
        calls.push({ query, opts });
        const host = query.startsWith('site:one.example')
          ? 'one.example'
          : 'two.example';
        return {
          results: [
            { title: host, url: `https://${host}/result`, content: '' },
          ],
        };
      },
      runSearch: async () => {
        throw new Error('AI search must not run');
      },
      createRequestId: () => 'no-sites-leak',
      now: () => 0,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map(({ query }) => query),
    ['site:one.example scope', 'site:two.example scope'],
  );
  for (const { opts } of calls) {
    assert.equal(Object.hasOwn(opts ?? {}, 'sites'), false);
    assert.equal(opts?.safesearch, 2);
    assert.deepEqual(opts?.engines, ['google', 'naver']);
  }
});

test('results-only search without sites makes one unmodified query', async () => {
  const calls: Array<{ query: string; opts?: Record<string, unknown> }> = [];

  const response = await handleCompatSearch(
    new Request('http://localhost/search?q=plain%20query&engines=naver'),
    {
      getModels: async () => {
        throw new Error('models must not be loaded');
      },
      searchSearxng: async (query, opts) => {
        calls.push({ query, opts });
        return { results: [] };
      },
      runSearch: async () => {
        throw new Error('AI search must not run');
      },
      createRequestId: () => 'plain-results',
      now: () => 0,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    { query: 'plain query', opts: { engines: ['naver'] } },
  ]);
  assert.deepEqual((await response.json()).results, []);
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

test('routes youtube through its own engine instead of a site: search', async () => {
  const calls: Array<{ query: string; engines?: string[] }> = [];

  const response = await handleCompatSearch(
    new Request(
      'http://localhost/api/search/compat?q=전입신고&sites=namu.wiki,youtube.com&engines=naver',
    ),
    {
      getModels: async () => {
        throw new Error('models must not be loaded');
      },
      searchSearxng: async (query, opts) => {
        calls.push({ query, engines: (opts as { engines?: string[] })?.engines });
        const isYoutube = !query.startsWith('site:');

        return {
          results: [
            isYoutube
              ? {
                  title: 'video',
                  url: 'https://www.youtube.com/watch?v=abc',
                  content: 'v',
                }
              : { title: 'wiki', url: 'https://namu.wiki/w/x', content: 'w' },
          ],
        };
      },
      runSearch: async () => {
        throw new Error('AI search must not run');
      },
      createRequestId: () => 'youtube-request',
      now: () => 0,
    },
  );

  const body = await response.json();

  assert.deepEqual(calls, [
    { query: 'site:namu.wiki 전입신고', engines: ['naver'] },
    { query: '전입신고', engines: ['youtube'] },
  ]);
  assert.deepEqual(
    body.results.map((r: { url: string }) => r.url),
    ['https://namu.wiki/w/x', 'https://www.youtube.com/watch?v=abc'],
  );
});

test('youtube override keeps the original query and does not change peer engines', async () => {
  const calls: Array<{ query: string; engines?: string[]; safesearch?: number }> =
    [];

  const response = await handleCompatSearch(
    new Request(
      'http://localhost/search?q=exact%20original&sites=youtube.com,docs.example&safesearch=2',
    ),
    {
      getModels: async () => {
        throw new Error('models must not be loaded');
      },
      searchSearxng: async (query, opts) => {
        calls.push({
          query,
          engines: opts?.engines as string[] | undefined,
          safesearch: opts?.safesearch as number | undefined,
        });
        return {
          results: query.startsWith('site:')
            ? [
                {
                  title: 'docs',
                  url: 'https://docs.example/x',
                  content: '',
                },
              ]
            : [
                {
                  title: 'video',
                  url: 'https://youtube.com/watch?v=x',
                  content: '',
                },
              ],
        };
      },
      runSearch: async () => {
        throw new Error('AI search must not run');
      },
      createRequestId: () => 'youtube-isolation',
      now: () => 0,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    { query: 'exact original', engines: ['youtube'], safesearch: 2 },
    {
      query: 'site:docs.example exact original',
      engines: ['google', 'naver'],
      safesearch: 2,
    },
  ]);
});

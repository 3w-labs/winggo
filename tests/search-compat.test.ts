import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompatRequestError,
  formatCompatResultsResponse,
  formatCompatSearchResponse,
  getModeTimeout,
  parseCompatSearchRequest,
  reconcileCitations,
} from '../src/lib/agents/search/compat.ts';

test('parses the supported SearXNG query parameters', () => {
  const result = parseCompatSearchRequest(
    'http://localhost/search?q=winggo&format=json&categories=general,news&pageno=2&language=ko&time_range=month&engines=google,bing&optimizationMode=quality&ignored=x',
  );

  assert.deepEqual(result, {
    query: 'winggo',
    optimizationMode: 'quality',
    citationMode: 'strict',
    searchOptions: {
      categories: ['general', 'news'],
      engines: ['google', 'bing'],
      language: 'ko',
      pageno: 2,
      time_range: 'month',
    },
  });
});

test('omits empty optional values', () => {
  const result = parseCompatSearchRequest(
    'http://localhost/search?q=winggo&optimizationMode=speed&categories=&engines=',
  );

  assert.deepEqual(result, {
    query: 'winggo',
    optimizationMode: 'speed',
    citationMode: 'strict',
    searchOptions: {},
  });
});

test('rejects invalid compatibility requests with stable codes', () => {
  const cases = [
    ['/search?optimizationMode=speed', 'missing_query'],
    ['/search?q=x&format=html&optimizationMode=speed', 'invalid_format'],
    ['/search?q=x&pageno=0&optimizationMode=speed', 'invalid_pageno'],
    ['/search?q=x&pageno=1.5&optimizationMode=speed', 'invalid_pageno'],
    ['/search?q=x&time_range=week&optimizationMode=speed', 'invalid_time_range'],
    ['/search?q=x&optimizationMode=turbo', 'invalid_optimization_mode'],
    ['/search?q=x&sites=namu.wiki&safesearch=3', 'invalid_safesearch'],
    ['/search?q=x&sites=not-a-domain', 'invalid_sites'],
  ] as const;

  for (const [path, code] of cases) {
    assert.throws(
      () => parseCompatSearchRequest(`http://localhost${path}`),
      (error) =>
        error instanceof CompatRequestError &&
        error.status === 400 &&
        error.code === code,
    );
  }
});

test('formats Winggo sources as an extended SearXNG-compatible response', () => {
  const result = formatCompatSearchResponse({
    query: 'winggo',
    optimizationMode: 'balanced',
    message: 'AI answer',
    sources: [
      {
        content: 'Source text',
        metadata: { title: 'Source title', url: 'https://example.com' },
      },
    ],
    requestId: 'request-1',
    elapsedMs: 123,
  });

  assert.deepEqual(result, {
    query: 'winggo',
    optimizationMode: 'balanced',
    answer: 'AI answer',
    results: [
      {
        title: 'Source title',
        url: 'https://example.com',
        content: 'Source text',
      },
    ],
    citations: [],
    meta: { requestId: 'request-1', elapsedMs: 123, danglingCitations: [] },
  });
});

test('parses site scope and defaults engines to google plus naver', () => {
  const result = parseCompatSearchRequest(
    'http://localhost/search?q=아이유&sites=https://namu.wiki/w/x,www.brunch.co.kr,namu.wiki',
  );

  assert.deepEqual(result, {
    query: '아이유',
    optimizationMode: undefined,
    citationMode: 'strict',
    searchOptions: {
      engines: ['google', 'naver'],
      safesearch: 1,
    },
    siteScope: { sites: ['namu.wiki', 'brunch.co.kr'] },
  });
});

test('explicit engines and safesearch win over the site scope defaults', () => {
  const result = parseCompatSearchRequest(
    'http://localhost/search?q=x&sites=namu.wiki&engines=naver&safesearch=2&optimizationMode=speed',
  );

  assert.equal(result.optimizationMode, 'speed');
  assert.deepEqual(result.searchOptions.engines, ['naver']);
  assert.equal(result.searchOptions.safesearch, 2);
});

test('omitting optimizationMode selects results-only mode', () => {
  const result = parseCompatSearchRequest('http://localhost/search?q=winggo');

  assert.equal(result.optimizationMode, undefined);
  assert.equal(getModeTimeout(result.optimizationMode), 30_000);
});

test('drops citations that point past the end of the source list', () => {
  const results = [
    { url: 'https://a.example' },
    { url: 'https://b.example' },
    { url: 'https://c.example' },
  ];
  const { message, cited } = reconcileCitations(
    'A[1] B[2] C[19] D[3][28] E[1-28] F[2~3]',
    results,
  );

  assert.equal(message, 'A[1] B[2] C D[3] E[1-3] F[2~3]');
  assert.deepEqual(cited, [1, 2, 3]);
});

test('a citation range never spans a result without a followable URL', () => {
  const results = [
    { url: 'https://a.example' },
    { url: '' },
    { url: 'https://c.example' },
  ];

  const reconciled = reconcileCitations('Sources [1-3].', results);

  // Keeping "[1-3]" would still assert that result 2 is traceable. Split the
  // surviving references instead of representing a non-contiguous set as a
  // contiguous range.
  assert.equal(reconciled.message, 'Sources [1][3].');
  assert.deepEqual(reconciled.cited, [1, 3]);
  assert.deepEqual(reconciled.dangling, [2]);
});

test('four-digit, zero, and repeated citation numbers are reconciled', () => {
  const results = [{ url: 'https://a.example' }];
  const reconciled = reconcileCitations(
    'repeat[1][1] zero[0] large[1000]',
    results,
  );

  assert.equal(reconciled.message, 'repeat[1][1] zero large');
  assert.deepEqual(reconciled.cited, [1]);
  assert.deepEqual(reconciled.dangling, [0, 1000]);
});

test('answers only cite sources that are returned', () => {
  const result = formatCompatSearchResponse({
    query: 'winggo',
    optimizationMode: 'quality',
    message: 'Real[1] dangling[9] done.',
    sources: [
      {
        content: 'Source text',
        metadata: { title: 'Source title', url: 'https://example.com' },
      },
    ],
    requestId: 'request-2',
    elapsedMs: 5,
  });

  assert.equal(result.answer, 'Real[1] dangling done.');
  assert.deepEqual(result.citations, [
    { n: 1, title: 'Source title', url: 'https://example.com' },
  ]);

  const cited = new Set(result.citations.map((citation) => citation.url));
  for (const citation of result.citations) {
    assert.ok(result.results.some((r) => r.url === citation.url));
  }
  assert.equal(cited.size, result.citations.length);
});

test('results-only responses keep the SearXNG shape', () => {
  const result = formatCompatResultsResponse({
    query: 'winggo',
    sources: [
      {
        content: 'Snippet',
        metadata: { title: 'Title', url: 'https://namu.wiki/w/x' },
      },
    ],
    requestId: 'request-3',
    elapsedMs: 7,
  });

  assert.deepEqual(result, {
    query: 'winggo',
    results: [
      { title: 'Title', url: 'https://namu.wiki/w/x', content: 'Snippet' },
    ],
    unresponsive_engines: [],
    meta: { requestId: 'request-3', elapsedMs: 7 },
  });
  assert.ok(!('answer' in result));
});

test('drops citations whose result has no followable URL', () => {
  const result = formatCompatSearchResponse({
    query: 'winggo',
    optimizationMode: 'quality',
    message: 'Good[1] blank[2] end.',
    sources: [
      {
        content: 'first',
        metadata: { title: 'First', url: 'https://example.com' },
      },
      { content: 'second', metadata: { title: 'Second' } },
    ],
    requestId: 'request-4',
    elapsedMs: 1,
  });

  assert.equal(result.answer, 'Good[1] blank end.');
  assert.deepEqual(result.citations, [
    { n: 1, title: 'First', url: 'https://example.com' },
  ]);
});

test('normalizes internationalized and credential-bearing sites safely', () => {
  const parsed = parseCompatSearchRequest(
    'http://localhost/search?q=x&sites=한글.kr',
  );
  assert.deepEqual(parsed.siteScope, { sites: ['xn--bj0bj06e.kr'] });

  assert.throws(
    () =>
      parseCompatSearchRequest(
        'http://localhost/search?q=x&sites=' +
          encodeURIComponent('https://user:pw@namu.wiki'),
      ),
    (error) => error instanceof CompatRequestError && error.code === 'invalid_sites',
  );
});

test('reports unresponsive engines so empty results are explainable', () => {
  const result = formatCompatResultsResponse({
    query: 'winggo',
    sources: [],
    unresponsiveEngines: [['google', 'Suspended: too many requests']],
    requestId: 'request-5',
    elapsedMs: 3,
  });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.unresponsive_engines, [
    ['google', 'Suspended: too many requests'],
  ]);
});

test('citations=raw keeps the answer verbatim but still reports what dangles', () => {
  const sources = [
    {
      content: 'Source text',
      metadata: { title: 'Source title', url: 'https://example.com' },
    },
  ];
  const message = 'Real[1] dangling[9] done.';

  const strict = formatCompatSearchResponse({
    query: 'winggo',
    optimizationMode: 'quality',
    citationMode: 'strict',
    message,
    sources,
    requestId: 'strict-request',
    elapsedMs: 1,
  });
  const raw = formatCompatSearchResponse({
    query: 'winggo',
    optimizationMode: 'quality',
    citationMode: 'raw',
    message,
    sources,
    requestId: 'raw-request',
    elapsedMs: 1,
  });

  assert.equal(strict.answer, 'Real[1] dangling done.');
  assert.equal(raw.answer, message);

  // both modes describe reality identically
  assert.deepEqual(strict.citations, raw.citations);
  assert.deepEqual(strict.meta.danglingCitations, [9]);
  assert.deepEqual(raw.meta.danglingCitations, [9]);
});

test('rejects an unknown citations mode', () => {
  assert.throws(
    () =>
      parseCompatSearchRequest('http://localhost/search?q=x&citations=loose'),
    (error) =>
      error instanceof CompatRequestError && error.code === 'invalid_citations',
  );
});

test('a reversed range is dropped rather than half-honoured', () => {
  // Malformed input the model has never actually produced; pinned so the
  // behaviour is a decision rather than an accident.
  const results = [{ url: 'https://a' }, { url: 'https://b' }, { url: 'https://c' }];
  const reconciled = reconcileCitations('x[3-1]', results);

  assert.equal(reconciled.message, 'x');
  assert.deepEqual(reconciled.cited, []);
});

test('a sites parameter with nothing usable is rejected', () => {
  // Sending `sites` and getting an unscoped search back would drop the site
  // limit and its safesearch default without telling the caller.
  for (const value of ['', ',,,', '%20%20']) {
    assert.throws(
      () =>
        parseCompatSearchRequest(`http://localhost/search?q=x&sites=${value}`),
      (error) =>
        error instanceof CompatRequestError &&
        error.status === 400 &&
        error.code === 'invalid_sites',
      `sites=${value} should be rejected`,
    );
  }

  // omitting it entirely still means "no site scope"
  const omitted = parseCompatSearchRequest('http://localhost/search?q=x');
  assert.equal(omitted.siteScope, undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompatRequestError,
  formatCompatSearchResponse,
  parseCompatSearchRequest,
} from '../src/lib/agents/search/compat.ts';

test('parses the supported SearXNG query parameters', () => {
  const result = parseCompatSearchRequest(
    'http://localhost/search?q=winggo&format=json&categories=general,news&pageno=2&language=ko&time_range=month&engines=google,bing&optimizationMode=quality&ignored=x',
  );

  assert.deepEqual(result, {
    query: 'winggo',
    optimizationMode: 'quality',
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
    ['/search?q=x', 'invalid_optimization_mode'],
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
    meta: { requestId: 'request-1', elapsedMs: 123 },
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSearxngSearchOptions } from '../src/lib/agents/search/searchOptions.ts';

test('preserves caller SearXNG options', () => {
  assert.deepEqual(
    mergeSearxngSearchOptions(
      {
        categories: ['general'],
        engines: ['google'],
        language: 'ko',
        pageno: 2,
        time_range: 'year',
      },
      undefined,
      false,
    ),
    {
      categories: ['general'],
      engines: ['google'],
      language: 'ko',
      pageno: 2,
      time_range: 'year',
    },
  );
});

test('lets action-specific options override caller options', () => {
  assert.deepEqual(
    mergeSearxngSearchOptions(
      { categories: ['general'], engines: ['google'], language: 'ko' },
      { categories: ['science'], engines: ['arxiv'] },
      false,
    ),
    { categories: ['science'], engines: ['arxiv'], language: 'ko' },
  );
});

test('forces the day range for realtime searches without dropping other options', () => {
  assert.deepEqual(
    mergeSearxngSearchOptions(
      {
        engines: ['google'],
        language: 'ko',
        pageno: 2,
        time_range: 'year',
      },
      { categories: ['general'] },
      true,
    ),
    {
      engines: ['google'],
      language: 'ko',
      pageno: 2,
      categories: ['general'],
      time_range: 'day',
    },
  );
});

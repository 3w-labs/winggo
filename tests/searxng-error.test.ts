import assert from 'node:assert/strict';
import test from 'node:test';
import { SearxngUnavailableError } from '../src/lib/searxngError.ts';

test('exposes a stable public SearXNG-unavailable error type', () => {
  const cause = new Error('connection refused');
  const error = new SearxngUnavailableError('SearXNG request failed', cause);

  assert.equal(error.name, 'SearxngUnavailableError');
  assert.equal(error.message, 'SearXNG request failed');
  assert.equal(error.cause, cause);
});

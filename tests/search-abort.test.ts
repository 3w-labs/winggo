import assert from 'node:assert/strict';
import test from 'node:test';
import { combineAbortSignals } from '../src/lib/agents/search/abort.ts';

test('aborts combined work when the client disconnects', () => {
  const client = new AbortController();
  const deadline = new AbortController();
  const combined = combineAbortSignals(client.signal, deadline.signal);

  client.abort(new DOMException('Client disconnected', 'AbortError'));

  assert.equal(combined.aborted, true);
  assert.equal((combined.reason as DOMException).name, 'AbortError');
});

test('aborts combined work when its deadline expires', () => {
  const client = new AbortController();
  const deadline = new AbortController();
  const combined = combineAbortSignals(client.signal, deadline.signal);

  deadline.abort(new DOMException('Timed out', 'TimeoutError'));

  assert.equal(combined.aborted, true);
  assert.equal((combined.reason as DOMException).name, 'TimeoutError');
});

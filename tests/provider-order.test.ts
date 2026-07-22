import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInConfiguredOrder } from '../src/lib/models/providerOrder.ts';

test('preserves configured provider order despite different response times', async () => {
  const result = await resolveInConfiguredOrder([
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return 'first';
    },
    async () => 'second',
  ]);

  assert.deepEqual(result, ['first', 'second']);
});

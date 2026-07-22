import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKING_SEARXNG_REF =
  'b5ef7ec8f32b7020cc0f887e26f0d01b85949d17';

test('the full image checks out the verified SearXNG revision', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');

  assert.match(
    dockerfile,
    new RegExp(`ARG SEARXNG_REF=${WORKING_SEARXNG_REF}`),
  );
  assert.match(
    dockerfile,
    /git -C "\/usr\/local\/searxng\/searxng-src" checkout "\$SEARXNG_REF"/,
  );
});

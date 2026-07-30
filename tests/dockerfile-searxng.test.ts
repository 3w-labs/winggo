import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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
  assert.match(
    dockerfile,
    /COPY searxng\/engines\/google_cse\.py "\/usr\/local\/searxng\/searxng-src\/searx\/engines\/google_cse\.py"|COPY searxng\/engines\/google_cse\.py \/usr\/local\/searxng\/searxng-src\/searx\/engines\/google_cse\.py/,
  );
});

// relative_dates.py is not an engine, so nothing in settings.yml names it and a
// missing COPY would surface only as an ImportError at SearXNG startup -- taking
// down korean_site_search's eight sites and youtube with it.
test('every engine module the image needs is copied into it', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  const modules = await readdir('searxng/engines');

  for (const module of modules.filter((name) => name.endsWith('.py'))) {
    assert.ok(
      dockerfile.includes(`COPY searxng/engines/${module} `),
      `Dockerfile does not copy searxng/engines/${module}`,
    );
  }
});

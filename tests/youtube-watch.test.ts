import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  fetchYoutubeWatchPage,
  isYoutubeWatchUrl,
} from '../src/lib/youtubeWatch.ts';

const FIXTURE = 'tests/fixtures/youtube-watch-page.html';

/** Runs `body` with a stubbed fetch, and restores the real one afterwards. */
const withFetch = async (
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
  body: (calls: Array<{ url: string; init: RequestInit }>) => Promise<void>,
) => {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof globalThis.fetch;

  try {
    await body(calls);
  } finally {
    globalThis.fetch = real;
  }
};

test('recognises the watch URLs the pipeline can be handed', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=6-bIPQPBUtY',
    'http://youtube.com/watch?v=6-bIPQPBUtY&t=30',
    'https://m.youtube.com/watch?v=6-bIPQPBUtY',
    'https://youtu.be/6-bIPQPBUtY',
  ]) {
    assert.ok(isYoutubeWatchUrl(url), url);
  }

  // Not a single video: nothing to read a description off.
  for (const url of [
    'https://www.youtube.com/results?search_query=x',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/',
    'https://notyoutube.com/watch?v=6-bIPQPBUtY',
    'https://namu.wiki/w/youtube.com/watch?v=x',
  ]) {
    assert.ok(!isYoutubeWatchUrl(url), url);
  }
});

// The fixture is real bytes from a live watch page, not a hand-written shape:
// a stub built to match the regexes would prove nothing about the real page.
test('reads title, description and exact date off a real watch page', async () => {
  const html = await readFile(FIXTURE, 'utf8');

  await withFetch(
    () => new Response(html, { status: 200 }),
    async (calls) => {
      const page = await fetchYoutubeWatchPage(
        'https://www.youtube.com/watch?v=6-bIPQPBUtY',
      );

      assert.ok(page);
      assert.match(page.title, /^"현시점 가성비 TOP5" 2026 가성비 노트북 추천/);
      // The publication date the search result could only approximate.
      assert.equal(page.publishedDate, '2026-07-03T00:00:35-07:00');

      // Real descriptions are multi-line with escapes; the JSON literal must be
      // decoded, not passed through raw.
      assert.ok(page.description.includes('\n'));
      assert.ok(!page.description.includes('\\n'));
      assert.ok(page.description.length > 1000);
      assert.match(page.description, /리뷰머신 공동구매 캘린더/);

      assert.equal(calls.length, 1);
      // A consent interstitial carries no player response at all.
      const headers = calls[0].init.headers as Record<string, string>;
      assert.match(headers['Cookie'], /CONSENT=YES/);
    },
  );
});

test('a page that yields neither title nor description is a miss, not an empty page', async () => {
  for (const [label, response] of [
    ['bot check', new Response('<html>Sign in to confirm', { status: 200 })],
    ['not found', new Response('', { status: 404 })],
    ['server error', new Response('', { status: 503 })],
  ] as const) {
    await withFetch(
      () => response,
      async () => {
        const page = await fetchYoutubeWatchPage(
          'https://www.youtube.com/watch?v=6-bIPQPBUtY',
        );
        // null, so the caller falls back to the generic scraper instead of
        // recording the video as having no description.
        assert.equal(page, null, label);
      },
    );
  }
});

test('a network failure is a miss too', async () => {
  await withFetch(
    () => {
      throw new Error('ECONNRESET');
    },
    async () => {
      assert.equal(
        await fetchYoutubeWatchPage('https://www.youtube.com/watch?v=x'),
        null,
      );
    },
  );
});

test('an aborted search is not turned into a fallback', async () => {
  const controller = new AbortController();
  controller.abort();

  await withFetch(
    () => {
      throw new DOMException('aborted', 'AbortError');
    },
    async () => {
      // Returning null here would send the caller off to start a browser for a
      // search the user already gave up on.
      await assert.rejects(
        fetchYoutubeWatchPage(
          'https://www.youtube.com/watch?v=x',
          controller.signal,
        ),
      );
    },
  );
});

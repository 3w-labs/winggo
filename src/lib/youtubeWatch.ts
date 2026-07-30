import { combineAbortSignals } from './agents/search/abort.ts';

/**
 * A YouTube watch page, read without a browser.
 *
 * The generic scraper drives headless Chromium and then runs Readability, which
 * on a watch page returns the player chrome rather than anything about the
 * video. Everything worth having -- the description, the exact publication date
 * -- sits in the JSON the server already embeds, so a plain fetch gets a better
 * answer for a fraction of the cost.
 */

// The search engine only ever emits the `watch?v=` form, but a link from Google
// or Naver can arrive shortened.
const WATCH_URL = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?/i;
const SHORT_URL = /^https?:\/\/youtu\.be\/[\w-]{11}/i;

// Fields of `ytInitialPlayerResponse`. They are read with a regex rather than by
// parsing the whole blob: the page carries several megabytes of JSON and only
// these three are wanted.
const DESCRIPTION = /"shortDescription":"((?:[^"\\]|\\.)*)"/;
const PUBLISH_DATE = /"publishDate":"([^"]+)"/;
const TITLE = /"title":"((?:[^"\\]|\\.)*)","lengthSeconds"/;

const FETCH_TIMEOUT = 10_000;

export const isYoutubeWatchUrl = (url: string): boolean =>
  WATCH_URL.test(url) || SHORT_URL.test(url);

/** The JSON string literal at `match`, decoded, or '' when it is absent. */
const decode = (html: string, pattern: RegExp): string => {
  const match = html.match(pattern);
  if (!match) return '';

  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return '';
  }
};

export type YoutubeWatchPage = {
  title: string;
  description: string;
  /** ISO 8601, straight from the page -- far more precise than the search
   *  result's "3주 전", which carries no day of the month. */
  publishedDate?: string;
};

/**
 * The description and publication date of a watch page, or null when the page
 * did not yield them -- YouTube served a consent wall or a bot check, or the
 * video simply has no description. The caller falls back to the generic
 * scraper rather than treating null as an empty page.
 */
export const fetchYoutubeWatchPage = async (
  url: string,
  signal?: AbortSignal,
): Promise<YoutubeWatchPage | null> => {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal: combineAbortSignals(signal, timeoutSignal),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        // Without it YouTube answers some regions with a consent interstitial
        // that carries no player response.
        Cookie: 'CONSENT=YES+',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    const description = decode(html, DESCRIPTION);
    const title = decode(html, TITLE);

    // A video may legitimately have no description, but a page with neither a
    // description nor a title is not a watch page we managed to read.
    if (!description && !title) return null;

    const publishedDate = html.match(PUBLISH_DATE)?.[1];

    return {
      title,
      description,
      ...(publishedDate ? { publishedDate } : {}),
    };
  } catch (err) {
    // An abort is the caller giving up and must not be swallowed into a
    // fallback that starts a browser.
    signal?.throwIfAborted();
    console.log('Error reading YouTube watch page', url, err);
    return null;
  }
};

import { getSearxngURL } from './config/serverRegistry';
import { combineAbortSignals } from './agents/search/abort';
import { SearxngUnavailableError } from './searxngError';

export interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
  safesearch?: 0 | 1 | 2;
}

export type SearxngUnresponsiveEngine = [engine: string, reason: string];

interface SearxngSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
}

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
  signal?: AbortSignal,
) => {
  const searxngURL = getSearxngURL();

  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append('q', query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key as keyof SearxngSearchOptions];
      if (Array.isArray(value)) {
        url.searchParams.append(key, value.join(','));
        return;
      }
      url.searchParams.append(key, value as string);
    });
  }

  const timeoutSignal = AbortSignal.timeout(10_000);
  const requestSignal = combineAbortSignals(signal, timeoutSignal);

  try {
    const res = await fetch(url, {
      signal: requestSignal,
    });

    if (!res.ok) {
      throw new SearxngUnavailableError(
        `SearXNG returned ${res.status}: ${res.statusText}`,
      );
    }

    const data = await res.json();

    const results: SearxngSearchResult[] = data.results;
    const suggestions: string[] = data.suggestions;
    // [name, reason] pairs, e.g. ["google", "Suspended: too many requests"].
    // Passed through so callers can tell "engine down" from "nothing found".
    const unresponsiveEngines: SearxngUnresponsiveEngine[] =
      data.unresponsive_engines ?? [];

    return { results, suggestions, unresponsiveEngines };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof SearxngUnavailableError) throw error;
    throw new SearxngUnavailableError('SearXNG request failed', error);
  }
};

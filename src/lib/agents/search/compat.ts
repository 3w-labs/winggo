import { normalizeSite, type SiteScope } from './siteScope.ts';

export type OptimizationMode = 'speed' | 'balanced' | 'quality';

/** Engines used when a caller scopes to sites without naming engines. */
export const DEFAULT_SITE_SCOPE_ENGINES = ['google', 'naver'];

export type CompatSearchOptions = {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
  safesearch?: 0 | 1 | 2;
};

/**
 * `strict` drops citation markers with no resolvable source; `raw` leaves the
 * answer exactly as the model wrote it. Either way the `citations` map and
 * `meta.danglingCitations` describe what actually resolves.
 */
export type CitationMode = 'strict' | 'raw';

export type CompatSearchRequest = {
  query: string;
  /** Absent means results-only mode: search runs, no model is loaded. */
  optimizationMode?: OptimizationMode;
  citationMode: CitationMode;
  searchOptions: CompatSearchOptions;
  siteScope?: SiteScope;
};

type CompatSource = {
  content: string;
  metadata: Record<string, unknown>;
};

type FormatCompatSearchResponseInput = {
  query: string;
  optimizationMode: OptimizationMode;
  citationMode?: CitationMode;
  message: string;
  sources: CompatSource[];
  requestId: string;
  elapsedMs: number;
};

export class CompatRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CompatRequestError';
    this.status = status;
    this.code = code;
  }
}

const splitList = (value: string | null): string[] | undefined => {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items && items.length > 0 ? items : undefined;
};

const parseSites = (value: string | null): SiteScope | undefined => {
  // Omitting the parameter means "no site scope". Sending it with nothing
  // usable (`sites=`, `sites=,,,`) is a caller mistake -- silently running an
  // unscoped search would drop the site limit and its safesearch default while
  // the caller believes both are in effect.
  if (value === null) return undefined;

  const raw = splitList(value);
  if (!raw) {
    throw new CompatRequestError(
      400,
      'invalid_sites',
      'Sites must list at least one domain.',
    );
  }

  const sites: string[] = [];
  for (const entry of raw) {
    const site = normalizeSite(entry);
    if (!site) {
      throw new CompatRequestError(
        400,
        'invalid_sites',
        `"${entry}" is not a valid site.`,
      );
    }
    if (!sites.includes(site)) sites.push(site);
  }

  return { sites };
};

export const parseCompatSearchRequest = (
  requestUrl: string,
): CompatSearchRequest => {
  const params = new URL(requestUrl).searchParams;
  const query = params.get('q')?.trim();

  if (!query) {
    throw new CompatRequestError(400, 'missing_query', 'Query is required.');
  }

  const format = params.get('format') ?? 'json';
  if (format !== 'json') {
    throw new CompatRequestError(
      400,
      'invalid_format',
      'Only JSON format is supported.',
    );
  }

  const modeValue = params.get('optimizationMode');
  if (modeValue !== null && !['speed', 'balanced', 'quality'].includes(modeValue)) {
    throw new CompatRequestError(
      400,
      'invalid_optimization_mode',
      'Optimization mode must be speed, balanced, or quality.',
    );
  }
  const optimizationMode = (modeValue ?? undefined) as
    | OptimizationMode
    | undefined;

  const citationValue = params.get('citations');
  if (citationValue !== null && !['strict', 'raw'].includes(citationValue)) {
    throw new CompatRequestError(
      400,
      'invalid_citations',
      'Citations must be strict or raw.',
    );
  }
  const citationMode = (citationValue ?? 'strict') as CitationMode;

  const searchOptions: CompatSearchOptions = {};
  const categories = splitList(params.get('categories'));
  const engines = splitList(params.get('engines'));
  const language = params.get('language')?.trim();
  const pageValue = params.get('pageno');
  const timeRange = params.get('time_range');

  const siteScope = parseSites(params.get('sites'));

  if (categories) searchOptions.categories = categories;
  if (engines) searchOptions.engines = engines;
  else if (siteScope) searchOptions.engines = [...DEFAULT_SITE_SCOPE_ENGINES];
  if (language) searchOptions.language = language;

  const safesearchValue = params.get('safesearch');
  if (safesearchValue !== null && safesearchValue !== '') {
    if (!['0', '1', '2'].includes(safesearchValue)) {
      throw new CompatRequestError(
        400,
        'invalid_safesearch',
        'Safe search must be 0, 1, or 2.',
      );
    }
    searchOptions.safesearch = Number(safesearchValue) as 0 | 1 | 2;
  } else if (siteScope) {
    searchOptions.safesearch = 1;
  }

  if (pageValue !== null) {
    const page = Number(pageValue);
    if (!Number.isInteger(page) || page < 1) {
      throw new CompatRequestError(
        400,
        'invalid_pageno',
        'Page number must be a positive integer.',
      );
    }
    searchOptions.pageno = page;
  }

  if (timeRange !== null && timeRange !== '') {
    if (!['day', 'month', 'year'].includes(timeRange)) {
      throw new CompatRequestError(
        400,
        'invalid_time_range',
        'Time range must be day, month, or year.',
      );
    }
    searchOptions.time_range = timeRange as 'day' | 'month' | 'year';
  }

  return {
    query,
    optimizationMode,
    citationMode,
    searchOptions,
    ...(siteScope ? { siteScope } : {}),
  };
};

const toResult = (source: CompatSource) => ({
  title: typeof source.metadata.title === 'string' ? source.metadata.title : '',
  url: typeof source.metadata.url === 'string' ? source.metadata.url : '',
  content: source.content,
});

// Digits are unbounded on purpose: a stray [1000] must be recognised so it can
// be dropped, not left in the answer because the pattern skipped it.
const CITATION_PATTERN = /\[(\d+)(\s*[-~]\s*(\d+))?\]/g;

/** Renders surviving numbers, collapsing only genuinely contiguous runs. */
const renderCitations = (numbers: number[]): string => {
  const groups: number[][] = [];

  for (const n of numbers) {
    const last = groups[groups.length - 1];
    if (last && n === last[last.length - 1] + 1) last.push(n);
    else groups.push([n]);
  }

  return groups
    .map((group) =>
      group.length === 1
        ? `[${group[0]}]`
        : `[${group[0]}-${group[group.length - 1]}]`,
    )
    .join('');
};

/**
 * Rewrites `[n]` markers so every one that survives points at a real result.
 *
 * The answer is written across several search rounds, so the model can emit a
 * number past the end of the final, de-duplicated source list. Those markers
 * are dropped rather than left dangling; ranges are clamped to the last real
 * source. Returns the cleaned message plus the numbers still referenced.
 */
const isUsableUrl = (url: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const reconcileCitations = (
  message: string,
  results: Array<{ url: string }>,
): { message: string; cited: number[]; dangling: number[] } => {
  const cited = new Set<number>();
  const dangling = new Set<number>();

  // A citation only survives if its number indexes a result that actually
  // carries a followable URL -- an in-range number pointing at a source with a
  // blank URL is just as untraceable as an out-of-range one.
  const resolvable = (n: number) =>
    n >= 1 && n <= results.length && isUsableUrl(results[n - 1].url);

  const cleaned = message.replace(
    CITATION_PATTERN,
    (full, startRaw: string, rangePart: string | undefined, endRaw: string) => {
      const start = Number(startRaw);

      if (rangePart === undefined) {
        if (!resolvable(start)) {
          dangling.add(start);
          return '';
        }
        cited.add(start);
        return full;
      }

      const end = Math.min(Number(endRaw), results.length);
      const inRange: number[] = [];
      for (let n = start; n <= end; n++) {
        if (resolvable(n)) inRange.push(n);
        else dangling.add(n);
      }
      for (let n = end + 1; n <= Number(endRaw); n++) dangling.add(n);

      if (inRange.length === 0) return '';
      inRange.forEach((n) => cited.add(n));

      // A range with a hole would still claim the skipped source is traceable,
      // so only an untouched, fully contiguous range keeps its original form.
      const intact =
        inRange[0] === start &&
        inRange[inRange.length - 1] === Number(endRaw) &&
        inRange.length === Number(endRaw) - start + 1;

      return intact ? full : renderCitations(inRange);
    },
  );

  return {
    message: cleaned,
    cited: [...cited].sort((a, b) => a - b),
    dangling: [...dangling].sort((a, b) => a - b),
  };
};

export const formatCompatSearchResponse = (
  input: FormatCompatSearchResponseInput,
) => {
  const results = input.sources.map(toResult);
  const { message, cited, dangling } = reconcileCitations(
    input.message,
    results,
  );

  return {
    query: input.query,
    optimizationMode: input.optimizationMode,
    // `raw` keeps the model's text verbatim; the dangling markers stay visible
    // but are still listed in meta so callers can act on them.
    answer: input.citationMode === 'raw' ? input.message : message,
    results,
    citations: cited.map((n) => ({
      n,
      title: results[n - 1].title,
      url: results[n - 1].url,
    })),
    meta: {
      requestId: input.requestId,
      elapsedMs: input.elapsedMs,
      danglingCitations: dangling,
    },
  };
};

export const formatCompatResultsResponse = (input: {
  query: string;
  sources: CompatSource[];
  unresponsiveEngines?: Array<[string, string]>;
  requestId: string;
  elapsedMs: number;
}) => ({
  query: input.query,
  results: input.sources.map(toResult),
  // Same key and shape SearXNG uses, so "engine down" stays distinguishable
  // from "nothing matched" without inspecting logs.
  unresponsive_engines: input.unresponsiveEngines ?? [],
  meta: {
    requestId: input.requestId,
    elapsedMs: input.elapsedMs,
  },
});

export const getModeTimeout = (mode?: OptimizationMode): number => {
  // Doubled from the original 30/45/90/180s. Scoped searches fan out one query
  // per requested site, so a quality run can issue several times the searches
  // it used to and the old ceiling was within seconds of the measured worst case.
  // The gateway's response_header_timeout must stay above the quality value.
  if (mode === undefined) return 60_000;
  if (mode === 'speed') return 90_000;
  if (mode === 'balanced') return 180_000;
  return 360_000;
};

export const buildCompatSystemInstructions = (
  language?: string,
  existing = '',
): string => {
  const instructions = existing.trim();
  if (language?.toLowerCase() !== 'ko') return instructions;
  return [instructions, 'Respond in Korean.'].filter(Boolean).join('\n');
};

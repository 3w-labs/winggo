import {
  buildCompatSystemInstructions,
  CompatRequestError,
  formatCompatResultsResponse,
  formatCompatSearchResponse,
  getModeTimeout,
  parseCompatSearchRequest,
} from './compat.ts';
import {
  balanceByDomain,
  buildSiteRequests,
  filterByDomain,
} from './siteScope.ts';
import { combineAbortSignals } from './abort.ts';
import { ModelNotConfiguredError } from '../../models/defaultModels.ts';
import { SearxngUnavailableError } from '../../searxngError.ts';

type Models = {
  chatModel: { providerId: string; key: string };
  embeddingModel: { providerId: string; key: string };
};

type SearchInput = {
  query: string;
  history: Array<[string, string]>;
  chatModel: Models['chatModel'];
  embeddingModel: Models['embeddingModel'];
  config: {
    sources: Array<'web' | 'discussions' | 'academic'>;
    realtimeSearch: boolean;
    mode: 'speed' | 'balanced' | 'quality';
    systemInstructions: string;
    searchOptions: Record<string, unknown>;
    siteScope?: { sites: string[] };
    widgetsEnabled: boolean;
  };
};

type SearxngSearch = (
  query: string,
  opts?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{
  results: Array<{ title: string; url: string; content?: string }>;
  unresponsiveEngines?: Array<[string, string]>;
}>;

type HandlerDependencies = {
  getModels: (signal: AbortSignal) => Promise<Models>;
  /** Injectable for tests; defaults to the real SearXNG client. */
  searchSearxng?: SearxngSearch;
  runSearch: (
    input: SearchInput,
    signal: AbortSignal,
  ) => Promise<{
    message: string;
    sources: Array<{ content: string; metadata: Record<string, unknown> }>;
  }>;
  createRequestId?: () => string;
  now?: () => number;
};

const errorResponse = (
  status: number,
  code: string,
  message: string,
  requestId: string,
) =>
  Response.json({ error: { code, message }, meta: { requestId } }, { status });

const RESULTS_ONLY_LIMIT = 20;

/**
 * Results-only search: run the query as given, keep the SearXNG shape.
 *
 * The AI path lets the model rewrite queries, so the `site:` scope has to be
 * re-applied per round. Here the caller's query is the query, so one fan-out
 * over the requested sites is enough.
 */
const runResultsOnlySearch = async (
  parsed: ReturnType<typeof parseCompatSearchRequest>,
  signal: AbortSignal,
  injectedSearch?: SearxngSearch,
) => {
  // Imported lazily so the AI path (and its tests) never pull in the SearXNG
  // client and its server-only config registry.
  const searchSearxng =
    injectedSearch ?? (await import('../../searxng.ts')).searchSearxng;

  const sites = parsed.siteScope?.sites ?? [];
  const requests = sites.length
    ? buildSiteRequests(parsed.query, sites)
    : [{ site: '', query: parsed.query }];

  const responses = await Promise.all(
    requests.map((request) =>
      searchSearxng(
        request.query,
        request.engines
          ? { ...parsed.searchOptions, engines: request.engines }
          : parsed.searchOptions,
        signal,
      ),
    ),
  );

  const results = responses.flatMap((res) => res.results);
  const scoped = sites.length
    ? filterByDomain(results, sites, (result) => result.url)
    : results;
  const limited = sites.length
    ? balanceByDomain(scoped, sites, RESULTS_ONLY_LIMIT, (result) => result.url)
    : scoped.slice(0, RESULTS_ONLY_LIMIT);

  // One fan-out query per site means the same engine can fail several times;
  // report each engine once, keeping the first reason seen.
  const unresponsiveEngines = new Map<string, string>();
  for (const res of responses) {
    for (const [engine, reason] of res.unresponsiveEngines ?? []) {
      if (!unresponsiveEngines.has(engine)) unresponsiveEngines.set(engine, reason);
    }
  }

  return {
    sources: limited.map((result) => ({
      content: result.content ?? '',
      metadata: { title: result.title, url: result.url },
    })),
    unresponsiveEngines: [...unresponsiveEngines.entries()],
  };
};

export const handleCompatSearch = async (
  req: Request,
  dependencies: HandlerDependencies,
): Promise<Response> => {
  const requestId = dependencies.createRequestId?.() ?? crypto.randomUUID();
  const now = dependencies.now ?? Date.now;
  const startedAt = now();

  try {
    const parsed = parseCompatSearchRequest(req.url);
    const signal = combineAbortSignals(
      req.signal,
      AbortSignal.timeout(getModeTimeout(parsed.optimizationMode)),
    );

    // No optimizationMode means the caller wants plain results. Skip the model
    // lookup entirely so the request works without a configured chat model.
    if (!parsed.optimizationMode) {
      const { sources, unresponsiveEngines } = await runResultsOnlySearch(
        parsed,
        signal,
        dependencies.searchSearxng,
      );

      return Response.json(
        formatCompatResultsResponse({
          query: parsed.query,
          sources,
          unresponsiveEngines,
          requestId,
          elapsedMs: now() - startedAt,
        }),
      );
    }

    const models = await dependencies.getModels(signal);
    const result = await dependencies.runSearch(
      {
        query: parsed.query,
        history: [],
        chatModel: models.chatModel,
        embeddingModel: models.embeddingModel,
        config: {
          sources: ['web'],
          realtimeSearch: false,
          mode: parsed.optimizationMode,
          systemInstructions: buildCompatSystemInstructions(
            parsed.searchOptions.language,
          ),
          searchOptions: parsed.searchOptions,
          siteScope: parsed.siteScope,
          widgetsEnabled: false,
        },
      },
      signal,
    );

    return Response.json(
      formatCompatSearchResponse({
        query: parsed.query,
        optimizationMode: parsed.optimizationMode,
        citationMode: parsed.citationMode,
        message: result.message,
        sources: result.sources,
        requestId,
        elapsedMs: now() - startedAt,
      }),
    );
  } catch (error) {
    if (error instanceof CompatRequestError) {
      return errorResponse(error.status, error.code, error.message, requestId);
    }
    if (error instanceof ModelNotConfiguredError) {
      return errorResponse(
        503,
        'model_not_configured',
        'A chat model and an embedding model must be configured.',
        requestId,
      );
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return errorResponse(
        504,
        'search_timeout',
        'AI search timed out.',
        requestId,
      );
    }
    if (error instanceof SearxngUnavailableError) {
      console.error(`[${requestId}] SearXNG unavailable`, error.cause);
      return errorResponse(
        502,
        'searxng_unavailable',
        'SearXNG is unavailable.',
        requestId,
      );
    }

    console.error(`[${requestId}] Winggo compatibility search failed`, error);
    return errorResponse(
      502,
      'winggo_search_failed',
      'AI search failed.',
      requestId,
    );
  }
};

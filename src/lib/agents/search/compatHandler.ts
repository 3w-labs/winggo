import {
  buildCompatSystemInstructions,
  CompatRequestError,
  formatCompatSearchResponse,
  getModeTimeout,
  parseCompatSearchRequest,
} from './compat.ts';
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
    widgetsEnabled: boolean;
  };
};

type HandlerDependencies = {
  getModels: () => Promise<Models>;
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
  Response.json(
    { error: { code, message }, meta: { requestId } },
    { status },
  );

export const handleCompatSearch = async (
  req: Request,
  dependencies: HandlerDependencies,
): Promise<Response> => {
  const requestId =
    dependencies.createRequestId?.() ?? crypto.randomUUID();
  const now = dependencies.now ?? Date.now;
  const startedAt = now();

  try {
    const parsed = parseCompatSearchRequest(req.url);
    const models = await dependencies.getModels();
    const signal = combineAbortSignals(
      req.signal,
      AbortSignal.timeout(getModeTimeout(parsed.optimizationMode)),
    );
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
          widgetsEnabled: false,
        },
      },
      signal,
    );

    return Response.json(
      formatCompatSearchResponse({
        query: parsed.query,
        optimizationMode: parsed.optimizationMode,
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

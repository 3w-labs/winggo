import {
  buildCompatSystemInstructions,
  CompatRequestError,
  formatCompatSearchResponse,
  getModeTimeout,
  parseCompatSearchRequest,
} from '@/lib/agents/search/compat';
import { runApiSearch } from '@/lib/agents/search/service';
import {
  getDefaultModels,
  ModelNotConfiguredError,
} from '@/lib/models/defaultModels';
import ModelRegistry from '@/lib/models/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export const GET = async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const parsed = parseCompatSearchRequest(req.url);
    const registry = new ModelRegistry();
    const models = await getDefaultModels(() => registry.getActiveProviders());
    const timeoutSignal = AbortSignal.timeout(
      getModeTimeout(parsed.optimizationMode),
    );
    const signal = AbortSignal.any([req.signal, timeoutSignal]);
    const result = await runApiSearch(
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
        elapsedMs: Date.now() - startedAt,
      }),
    );
  } catch (error) {
    if (error instanceof CompatRequestError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        requestId,
      );
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

    console.error(`[${requestId}] Winggo compatibility search failed`, error);
    return errorResponse(
      502,
      'winggo_search_failed',
      'AI search failed.',
      requestId,
    );
  }
};

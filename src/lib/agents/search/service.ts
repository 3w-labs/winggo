import ModelRegistry from '@/lib/models/registry';
import SessionManager from '@/lib/session';
import type { ChatTurnMessage, Chunk } from '@/lib/types';
import APISearchAgent from './api';
import type { SearchAgentConfig } from './types';
import type { ModelWithProvider } from '@/lib/models/types';

export type ApiSearchServiceInput = {
  query: string;
  history: Array<[string, string]>;
  chatModel: ModelWithProvider;
  embeddingModel: ModelWithProvider;
  config: Pick<
    SearchAgentConfig,
    | 'sources'
    | 'realtimeSearch'
    | 'mode'
    | 'systemInstructions'
    | 'searchOptions'
    | 'widgetsEnabled'
  >;
};

export type ApiSearchServiceResult = {
  message: string;
  sources: Chunk[];
};

export const runApiSearch = async (
  input: ApiSearchServiceInput,
  signal?: AbortSignal,
): Promise<ApiSearchServiceResult> => {
  signal?.throwIfAborted();
  const registry = new ModelRegistry();
  const [llm, embedding] = await Promise.all([
    registry.loadChatModel(
      input.chatModel.providerId,
      input.chatModel.key,
      signal,
    ),
    registry.loadEmbeddingModel(
      input.embeddingModel.providerId,
      input.embeddingModel.key,
      signal,
    ),
  ]);
  signal?.throwIfAborted();
  const chatHistory: ChatTurnMessage[] = input.history.map(([role, content]) =>
    role === 'human'
      ? { role: 'user', content }
      : { role: 'assistant', content },
  );
  const session = SessionManager.createSession();
  const agent = new APISearchAgent();

  return new Promise<ApiSearchServiceResult>((resolve, reject) => {
    let message = '';
    let sources: Chunk[] = [];
    let settled = false;

    const cleanup = () => {
      settled = true;
      disconnect();
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal?.reason ?? new Error('Search aborted'));
    const disconnect = session.subscribe(
      (event: string, data: Record<string, any>) => {
        if (event === 'data' && data.type === 'response') message += data.data;
        if (event === 'data' && data.type === 'searchResults') {
          sources = data.data as Chunk[];
        }
        if (event === 'end' && !settled) {
          cleanup();
          resolve({ message, sources });
        }
        if (event === 'error') fail(data);
      },
    );

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    void agent
      .searchAsync(session, {
        chatHistory,
        followUp: input.query,
        chatId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        config: {
          llm,
          embedding,
          sources: input.config.sources,
          realtimeSearch: input.config.realtimeSearch,
          mode: input.config.mode,
          fileIds: [],
          systemInstructions: input.config.systemInstructions,
          searchOptions: input.config.searchOptions,
          widgetsEnabled: input.config.widgetsEnabled,
        },
        signal,
      })
      .catch(fail);
  });
};

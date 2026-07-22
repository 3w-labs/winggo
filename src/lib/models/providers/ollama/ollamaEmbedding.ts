import { Ollama } from 'ollama';
import BaseEmbedding from '../../base/embedding';
import { Chunk } from '@/lib/types';

type OllamaConfig = {
  model: string;
  baseURL?: string;
};

class OllamaEmbedding extends BaseEmbedding<OllamaConfig> {
  ollamaClient: Ollama;

  constructor(protected config: OllamaConfig) {
    super(config);

    this.ollamaClient = new Ollama({
      host: this.config.baseURL || 'http://localhost:11434',
    });
  }

  async embedText(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const onAbort = () => this.ollamaClient.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      signal?.throwIfAborted();
      const response = await this.ollamaClient.embed({
      input: texts,
      model: this.config.model,
      });
      return response.embeddings;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async embedChunks(chunks: Chunk[], signal?: AbortSignal): Promise<number[][]> {
    return this.embedText(
      chunks.map((chunk) => chunk.content),
      signal,
    );
  }
}

export default OllamaEmbedding;

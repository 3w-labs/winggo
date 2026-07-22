import { Chunk } from '@/lib/types';
import BaseEmbedding from '../../base/embedding';
import { FeatureExtractionPipeline } from '@huggingface/transformers';

type TransformerConfig = {
  model: string;
};

class TransformerEmbedding extends BaseEmbedding<TransformerConfig> {
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(protected config: TransformerConfig) {
    super(config);
  }

  async embedText(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.embed(texts, signal);
  }

  async embedChunks(chunks: Chunk[], signal?: AbortSignal): Promise<number[][]> {
    return this.embed(
      chunks.map((c) => c.content),
      signal,
    );
  }

  private async embed(texts: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        const result = await pipeline('feature-extraction', this.config.model, {
          dtype: 'fp32',
        });
        return result as FeatureExtractionPipeline;
      })();
    }

    const pipe = await this.pipelinePromise;
    signal?.throwIfAborted();
    const output = await pipe(texts, { pooling: 'mean', normalize: true });
    signal?.throwIfAborted();
    return output.tolist() as number[][];
  }
}

export default TransformerEmbedding;

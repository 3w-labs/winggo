type Model = { key: string; name: string };
type Provider = {
  id: string;
  name: string;
  chatModels: Model[];
  embeddingModels: Model[];
};

export type DefaultModels = {
  chatModel: { providerId: string; key: string };
  embeddingModel: { providerId: string; key: string };
};

export class ModelNotConfiguredError extends Error {
  constructor() {
    super('A chat model and an embedding model must be configured.');
    this.name = 'ModelNotConfiguredError';
  }
}

const CACHE_TTL_MS = 60_000;
let cached: { value: DefaultModels; expiresAt: number } | undefined;

const firstUsableModel = (
  providers: Provider[],
  type: 'chatModels' | 'embeddingModels',
) => {
  for (const provider of providers) {
    const model = provider[type].find((candidate) => candidate.key !== 'error');
    if (model) return { providerId: provider.id, key: model.key };
  }
  return undefined;
};

export const selectDefaultModels = (providers: Provider[]): DefaultModels => {
  const chatModel = firstUsableModel(providers, 'chatModels');
  const embeddingModel = firstUsableModel(providers, 'embeddingModels');

  if (!chatModel || !embeddingModel) throw new ModelNotConfiguredError();
  return { chatModel, embeddingModel };
};

export const getDefaultModels = async (
  loadProviders: () => Promise<Provider[]>,
  now = Date.now(),
): Promise<DefaultModels> => {
  if (cached && now < cached.expiresAt) return cached.value;

  const value = selectDefaultModels(await loadProviders());
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
};

export const clearDefaultModelsCache = () => {
  cached = undefined;
};

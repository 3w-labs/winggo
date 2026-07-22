import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelNotConfiguredError,
  clearDefaultModelsCache,
  getDefaultModels,
  selectDefaultModels,
} from '../src/lib/models/defaultModels.ts';

const providers = [
  {
    id: 'chat-provider',
    name: 'Chat',
    chatModels: [
      { key: 'error', name: 'Unavailable' },
      { key: 'chat-model', name: 'Chat model' },
    ],
    embeddingModels: [],
  },
  {
    id: 'embedding-provider',
    name: 'Embedding',
    chatModels: [],
    embeddingModels: [{ key: 'embedding-model', name: 'Embedding model' }],
  },
];

test('selects the first usable chat and embedding models independently', () => {
  assert.deepEqual(selectDefaultModels(providers), {
    chatModel: { providerId: 'chat-provider', key: 'chat-model' },
    embeddingModel: {
      providerId: 'embedding-provider',
      key: 'embedding-model',
    },
  });
});

test('throws when either required model type is unavailable', () => {
  assert.throws(
    () =>
      selectDefaultModels([
        {
          id: 'chat-only',
          name: 'Chat only',
          chatModels: [{ key: 'chat', name: 'Chat' }],
          embeddingModels: [],
        },
      ]),
    (error) => error instanceof ModelNotConfiguredError,
  );
});

test('caches successful model discovery for sixty seconds', async () => {
  clearDefaultModelsCache();
  let calls = 0;
  const loadProviders = async () => {
    calls += 1;
    return providers;
  };

  await getDefaultModels(loadProviders, 1_000);
  await getDefaultModels(loadProviders, 60_999);
  assert.equal(calls, 1);

  await getDefaultModels(loadProviders, 61_000);
  assert.equal(calls, 2);
});

test('does not cache failed model discovery', async () => {
  clearDefaultModelsCache();
  let calls = 0;
  const loadProviders = async () => {
    calls += 1;
    return [];
  };

  await assert.rejects(() => getDefaultModels(loadProviders, 1_000));
  await assert.rejects(() => getDefaultModels(loadProviders, 1_001));
  assert.equal(calls, 2);
});

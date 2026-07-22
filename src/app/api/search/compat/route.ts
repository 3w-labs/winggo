import { handleCompatSearch } from '@/lib/agents/search/compatHandler';
import { runApiSearch } from '@/lib/agents/search/service';
import { getDefaultModels } from '@/lib/models/defaultModels';
import ModelRegistry from '@/lib/models/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: Request) => {
  const registry = new ModelRegistry();
  return handleCompatSearch(req, {
    getModels: (signal) =>
      getDefaultModels(() => registry.getActiveProviders(signal)),
    runSearch: runApiSearch,
  });
};

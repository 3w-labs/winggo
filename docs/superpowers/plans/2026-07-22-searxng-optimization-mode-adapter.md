# SearXNG optimizationMode Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the SearXNG-compatible `GET /search` contract while routing requests with `optimizationMode` through Winggo and returning an AI answer plus source results.

**Architecture:** Add a pure parser/formatter module, a reusable non-streaming API-search service, and `GET /api/search/compat`. Extend `SearchAgentConfig` so every internal SearXNG call receives the caller's search options; document the Caddy query-based route in Winggo without modifying another repository.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5.9, Zod 4, Node built-in test runner, existing Winggo model/search registries.

## Global Constraints

- Only the `winggo` repository may be modified.
- Preserve `q`, `format`, `categories`, `pageno`, `language`, `time_range`, and `engines` semantics.
- Accept only `speed`, `balanced`, or `quality` for `optimizationMode`.
- Do not accept model identifiers from external requests; select the first usable active chat and embedding models independently.
- Requests without `optimizationMode` remain the deployment proxy's responsibility and must continue to SearXNG unchanged.
- AI results are not cached; default-model discovery is cached in memory for 60 seconds.
- Timeouts are 45 seconds for speed, 90 seconds for balanced, and 180 seconds for quality.
- SearXNG core and settings are not modified.

---

### Task 1: Compatibility Request Contract

**Files:**
- Create: `src/lib/agents/search/compat.ts`
- Create: `tests/search-compat.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseCompatSearchRequest(url: string): CompatSearchRequest`
- Produces: `formatCompatSearchResponse(input): CompatSearchResponse`
- Produces: `CompatRequestError` with `status`, `code`, and safe `message`

- [ ] **Step 1: Add the Node test command and failing parser tests**

Add `"test": "node --experimental-strip-types --test tests/*.test.ts"` to `scripts`. Test valid comma-separated arrays, defaults, missing `q`, invalid mode, non-JSON format, invalid page, invalid time range, unknown-parameter omission, and source-to-result conversion:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompatRequestError,
  formatCompatSearchResponse,
  parseCompatSearchRequest,
} from '../src/lib/agents/search/compat.ts';

test('parses the supported SearXNG contract', () => {
  const parsed = parseCompatSearchRequest(
    'http://localhost/search?q=winggo&format=json&categories=general,news&pageno=2&language=ko&time_range=month&engines=google,bing&optimizationMode=quality&ignored=x',
  );
  assert.deepEqual(parsed, {
    query: 'winggo',
    optimizationMode: 'quality',
    searchOptions: {
      categories: ['general', 'news'],
      pageno: 2,
      language: 'ko',
      time_range: 'month',
      engines: ['google', 'bing'],
    },
  });
});

test('rejects invalid requests with stable error codes', () => {
  const cases = [
    ['/search?optimizationMode=speed', 'missing_query'],
    ['/search?q=x&format=html&optimizationMode=speed', 'invalid_format'],
    ['/search?q=x&pageno=0&optimizationMode=speed', 'invalid_pageno'],
    ['/search?q=x&time_range=week&optimizationMode=speed', 'invalid_time_range'],
    ['/search?q=x&optimizationMode=turbo', 'invalid_optimization_mode'],
  ];
  for (const [path, code] of cases) {
    assert.throws(
      () => parseCompatSearchRequest(`http://localhost${path}`),
      (error) => error instanceof CompatRequestError && error.code === code,
    );
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `yarn test`
Expected: FAIL because `src/lib/agents/search/compat.ts` does not exist.

- [ ] **Step 3: Implement the pure contract module**

Define literal unions, split non-empty comma values, default `format` to `json`, validate `pageno` as a positive integer, and return only the seven supported search fields plus `optimizationMode`. Map each source chunk to `{title, url, content}` and include `{requestId, elapsedMs}`.

```ts
export type OptimizationMode = 'speed' | 'balanced' | 'quality';
export type CompatSearchOptions = {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
};
export type CompatSearchRequest = {
  query: string;
  optimizationMode: OptimizationMode;
  searchOptions: CompatSearchOptions;
};
export class CompatRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
```

- [ ] **Step 4: Run contract tests**

Run: `yarn test`
Expected: all compatibility parser and formatter tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add package.json tests/search-compat.test.ts src/lib/agents/search/compat.ts
git commit -m "feat: define SearXNG AI compatibility contract"
```

### Task 2: Propagate SearXNG Options Through Winggo Research

**Files:**
- Modify: `src/lib/agents/search/types.ts`
- Modify: `src/lib/agents/search/researcher/actions/search/baseSearch.ts`
- Modify: `src/lib/agents/search/researcher/actions/search/webSearch.ts`
- Modify: `src/lib/agents/search/researcher/actions/search/socialSearch.ts`
- Modify: `src/lib/agents/search/researcher/actions/search/academicSearch.ts`
- Create: `tests/search-options.test.ts`

**Interfaces:**
- Consumes: `CompatSearchOptions` from Task 1
- Produces: `SearchAgentConfig.searchOptions?: SearxngSearchOptions`
- Produces: `mergeSearxngSearchOptions(configured, actionSpecific, realtime)`

- [ ] **Step 1: Write failing option-merge tests**

Test that caller options survive, action-specific categories override caller categories, and realtime search forces `time_range: 'day'` without losing engines, page, or language.

```ts
assert.deepEqual(
  mergeSearxngSearchOptions(
    { engines: ['google'], language: 'ko', pageno: 2, time_range: 'year' },
    { categories: ['general'] },
    true,
  ),
  {
    engines: ['google'], language: 'ko', pageno: 2,
    categories: ['general'], time_range: 'day',
  },
);
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `yarn test`
Expected: FAIL because `mergeSearxngSearchOptions` is not exported.

- [ ] **Step 3: Add config propagation and the merge helper**

Add `searchOptions?: SearxngSearchOptions` to `SearchAgentConfig`. Pass it from every search action into `executeSearch`; merge in this precedence order: caller options, action-specific source category, realtime day override. Replace both duplicated `searchSearxng` option literals in `baseSearch.ts` with the helper.

- [ ] **Step 4: Run tests and TypeScript**

Run: `yarn test && yarn tsc --noEmit`
Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit option propagation**

```bash
git add src/lib/agents/search tests/search-options.test.ts
git commit -m "feat: propagate SearXNG options through AI search"
```

### Task 3: Reusable AI Search Service and Default Models

**Files:**
- Create: `src/lib/agents/search/service.ts`
- Create: `src/lib/models/defaultModels.ts`
- Create: `tests/default-models.test.ts`
- Modify: `src/app/api/search/route.ts`

**Interfaces:**
- Produces: `selectDefaultModels(providers): { chatModel; embeddingModel }`
- Produces: `getDefaultModels(registry, now?): Promise<DefaultModels>` with a 60-second module cache
- Produces: `runApiSearch(input, signal): Promise<{ message: string; sources: Chunk[] }>`
- Consumes: `SearchAgentConfig.searchOptions` from Task 2

- [ ] **Step 1: Write failing default-model tests**

Cover independent providers, skipping `key: 'error'`, no configured chat model, no configured embedding model, reuse inside 60 seconds, and refresh after 60 seconds.

```ts
assert.deepEqual(selectDefaultModels([
  { id: 'chat-p', name: 'Chat', chatModels: [{ key: 'c', name: 'C' }], embeddingModels: [] },
  { id: 'embed-p', name: 'Embed', chatModels: [], embeddingModels: [{ key: 'e', name: 'E' }] },
]), {
  chatModel: { providerId: 'chat-p', key: 'c' },
  embeddingModel: { providerId: 'embed-p', key: 'e' },
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `yarn test`
Expected: FAIL because `defaultModels.ts` does not exist.

- [ ] **Step 3: Implement model selection and cached discovery**

Use the provider order returned by `ModelRegistry.getActiveProviders()`, filter error sentinel models, and throw a typed `ModelNotConfiguredError`. Cache only successful selections for 60,000 ms.

- [ ] **Step 4: Extract the non-streaming API search service**

Move model loading, history conversion, session subscription, `APISearchAgent.searchAsync`, response concatenation, source collection, abort cleanup, and error rejection from `POST /api/search` into `runApiSearch`. Keep streaming behavior in the existing route; use the shared service for `stream: false`. Ensure rejection and abort remove session listeners.

- [ ] **Step 5: Run tests, TypeScript, and build**

Run: `yarn test && yarn tsc --noEmit && yarn build`
Expected: tests PASS, TypeScript exits 0, and Next production build succeeds.

- [ ] **Step 6: Commit service extraction**

```bash
git add src/lib/agents/search/service.ts src/lib/models/defaultModels.ts src/app/api/search/route.ts tests/default-models.test.ts
git commit -m "refactor: share non-streaming AI search service"
```

### Task 4: GET Compatibility Route, Timeout, and Extended Response

**Files:**
- Create: `src/app/api/search/compat/route.ts`
- Create: `tests/search-timeout.test.ts`
- Modify: `src/lib/agents/search/compat.ts`

**Interfaces:**
- Consumes: `parseCompatSearchRequest`, `formatCompatSearchResponse`, `getDefaultModels`, and `runApiSearch`
- Produces: `GET(req: Request): Promise<Response>`
- Produces: `getModeTimeout(mode): 45000 | 90000 | 180000`

- [ ] **Step 1: Write failing timeout and Korean-instruction tests**

Verify exact timeout values and that `language=ko` produces the additive instruction `Respond in Korean.` without changing SearXNG `language`.

- [ ] **Step 2: Run tests and verify failure**

Run: `yarn test`
Expected: FAIL because timeout and instruction helpers do not exist.

- [ ] **Step 3: Implement the GET route**

Parse the URL, create a UUID request ID, select default models, combine the request signal with a mode-specific timeout signal, and call `runApiSearch` with `sources: ['web']`, empty history, `stream: false`, and parsed `searchOptions`. Format success as `{query, optimizationMode, answer, results, meta}`.

Map typed validation errors to 400, missing models to 503, abort due to deadline to `504 search_timeout`, known upstream failures to 502, and unexpected failures to `502 winggo_search_failed`. Log only request ID plus server-side error details.

- [ ] **Step 4: Run all local verification**

Run: `yarn test && yarn tsc --noEmit && yarn build`
Expected: all tests PASS and the production build succeeds.

- [ ] **Step 5: Commit the route**

```bash
git add src/app/api/search/compat/route.ts src/lib/agents/search/compat.ts tests/search-timeout.test.ts
git commit -m "feat: add SearXNG-compatible AI search endpoint"
```

### Task 5: Deployment Contract Documentation and Final Verification

**Files:**
- Create: `docs/API/SEARXNG_COMPAT.md`
- Modify: `docs/API/SEARCH.md`

**Interfaces:**
- Documents: authenticated Caddy routing to `/api/search/compat`
- Documents: request, extended response, error codes, and mode timeouts

- [ ] **Step 1: Document the external contract and Caddy snippet**

Include a Caddy example that matches any present `optimizationMode`, rewrites only the path to `/api/search/compat` while retaining the query string, proxies to Winggo `:3000`, keeps mode-less `/search` on SearXNG `:8080`, preserves Bearer authentication, and sets `response_header_timeout 190s`.

- [ ] **Step 2: Add curl examples**

Include one unchanged SearXNG request and one AI request containing all supported parameters. Show the extended JSON response and explicitly state that model query parameters are not accepted.

- [ ] **Step 3: Run final verification**

Run: `yarn test && yarn tsc --noEmit && yarn build && git diff --check`
Expected: tests PASS, TypeScript exits 0, production build succeeds, and no whitespace errors are reported.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/API/SEARCH.md docs/API/SEARXNG_COMPAT.md
git commit -m "docs: document SearXNG AI compatibility endpoint"
```

- [ ] **Step 5: Confirm repository scope**

Run: `git status --short --branch`
Expected: only the Winggo branch commits are ahead of `origin/master`; the working tree is clean.

# Google Web Engine Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:test-driven-development and execute the tasks inline. Do not
> commit; the user explicitly requested an uncommitted patch.

**Goal:** Restore web results for the `google` and `fmkorea` engines without
changing the verified SearXNG pin.

**Architecture:** Add a Google CSE JSONP overlay compatible with the pinned
SearXNG APIs. Map the engine name `google` to that overlay and make `fmkorea`
delegate to the same request/parser implementation.

**Tech Stack:** Python SearXNG engine API, Node test runner, fixed JSONP/HTML
fixtures, Dockerfile.

## Global Constraints

- Keep `SEARXNG_REF=b5ef7ec8f32b7020cc0f887e26f0d01b85949d17`.
- Do not change `optimizationMode` routing or existing Korean engine behavior.
- Do not access the production server.
- Do not make network access part of automated tests.
- Do not create a git commit.

---

### Task 1: Define parser and failure contracts

**Files:**
- Create: `tests/fixtures/google-cse-results.jsonp`
- Create: `tests/fixtures/google-js-stub.html`
- Create: `tests/google-web-engine.test.ts`

**Interfaces:**
- Consumes: Python module functions `response(resp)` and result mappings.
- Produces: failing tests for title/URL/content extraction and explicit
  JavaScript-stub failure.

- [ ] Add a two-result JSONP fixture with literal expected values.
- [ ] Add a minimal Google `enablejs` HTML fixture.
- [ ] Import the real Python module through a test harness with only SearXNG
  boundary modules stubbed.
- [ ] Run
  `node --experimental-strip-types --test tests/google-web-engine.test.ts` and
  confirm failure because `searxng/engines/google_cse.py` is absent.

### Task 2: Implement the CSE overlay

**Files:**
- Create: `searxng/engines/google_cse.py`

**Interfaces:**
- Produces: `setup(engine_settings)`, `request(query, params)`, and
  `response(resp) -> EngineResults`.
- Uses pinned `EngineCache`, `google.get_google_info`, and
  `google.filter_mapping`.

- [ ] Implement one-hour token caching from
  `https://www.google.com/cse/cse.js`.
- [ ] Build `https://cse.google.com/cse/element/v1` requests with paging,
  locale, safe search, and time range.
- [ ] Parse JSONP into result dictionaries containing `url`, `title`,
  `content`, and optional `thumbnail`.
- [ ] Reject blocked/stub/malformed response bodies explicitly.
- [ ] Re-run the focused test and confirm parser tests pass.

### Task 3: Connect `google` and `fmkorea`

**Files:**
- Modify: `searxng/settings.yml`
- Modify: `searxng/engines/fmkorea_google.py`
- Modify: `Dockerfile`
- Modify: `tests/dockerfile-searxng.test.ts`
- Modify: `tests/google-web-engine.test.ts`

**Interfaces:**
- `google` resolves to engine module `google_cse`.
- `fmkorea_google.request` delegates a `site:fmkorea.com` query to
  `google_cse.request`.
- `fmkorea_google.response` parses with `google_cse.response` and keeps only
  FMKorea hostnames.

- [ ] Add failing wiring and delegation tests.
- [ ] Copy the overlay into the image and map the settings entry.
- [ ] Replace the old GSA request path in `fmkorea_google.py` with delegation.
- [ ] Run both focused test files and confirm they pass.

### Task 4: Record evidence and verify regressions

**Files:**
- Create: `docs/operations/GOOGLE_WEB_ENGINE_RECOVERY.md`

- [ ] Record alternatives A/B/C, the selected approach, compatibility impact,
  CSE lifecycle tradeoff, and exact live-development-network observations.
- [ ] If the CSE endpoint is reachable, record request endpoint, HTTP status,
  and extracted result count; otherwise record that only fixtures were
  verified.
- [ ] Run
  `node --experimental-strip-types --test tests/*.test.ts`.
- [ ] Inspect `git diff --check`, `git status --short`, and the final diff.


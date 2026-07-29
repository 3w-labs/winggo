# Google Web Engine Recovery Design

## Goal

Keep the verified SearXNG revision pinned while making the engine named
`google` and the `fmkorea` engine return Google web results.  A blocked,
JavaScript-only, or malformed upstream response must be reported as an engine
error instead of being mistaken for a valid zero-result search.

## Decision

Add a pinned-revision-compatible Google CSE engine overlay and map the existing
`google` engine name to it in `searxng/settings.yml`.  Keep the pinned
`searx.engines.google` module untouched because Google Images, News, Scholar,
and other upstream engines import its locale and traits helpers.

The overlay follows upstream SearXNG's replacement for the broken Google HTML
engine: obtain the public Blackle CSE token, request Google's JSONP element
endpoint, and convert each item to an `EngineResults` main result.  The
`fmkorea` engine delegates request and response parsing to the same overlay,
adding `site:fmkorea.com` to the query and retaining its final hostname check.

## Alternatives considered

### A. Raise `SEARXNG_REF`

Rejected.  Upstream commit `1cdf01a71` describes the HTML engine as completely
broken and adds Google CSE as an alternative; current upstream does not repair
the engine named `google`.  Raising the pin therefore does not meet the goal.
It also reintroduces the known custom-engine startup regression caused by the
removal of `gen_gsa_useragent`, and would require a complete compatibility
matrix for `optimizationMode` routing and every Korean overlay before release.

### B. Overlay the HTML engine with another UA or query shape

Rejected after direct tests from the development environment.  Desktop,
Firefox, GSA, `udm=14`, `gbv=1`, and `client=firefox-b-d` requests all returned
HTTP 200 pages of about 91 KB with no result `<h3>` or `data-ved` result links.
Those pages cannot support a fixture-backed claim that web search works.

### C. Overlay Google CSE while preserving the pin

Selected.  This is the current upstream SearXNG fallback, returns structured
title/URL/content data without executing JavaScript, and isolates the change
from `optimizationMode` and the working Korean and Google vertical engines.

The tradeoff is reliance on a public CSE identifier and token endpoint.
Upstream notes that the current CSE mechanism is expected to change in 2027.
Failures are therefore surfaced explicitly and covered by tests rather than
silently returning an empty result list.

## Error handling

- A CSE token response without a usable token raises
  `SearxEngineAPIException`.
- A result response that is HTML, a Google JavaScript stub, empty, malformed
  JSONP, or missing both `results` and `error` raises
  `SearxEngineCaptchaException`.
- A structured CSE error raises `SearxEngineAPIException`; HTTP/rate-limit
  errors remain visible to SearXNG.
- A structured payload containing `results: []` is the only accepted
  zero-result response.

## Tests

Node's existing test runner launches a small isolated Python harness that
imports the real overlay with SearXNG boundary types stubbed locally.  Stored
JSONP and HTML fixtures verify extraction and blocked-page detection without
network access.  Additional assertions cover `fmkorea` delegation/domain
filtering and the Docker/settings wiring.


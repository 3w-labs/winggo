# SearXNG-Compatible AI Search

Winggo exposes `GET /api/search/compat` for deployments that already use the
SearXNG `GET /search` contract. A reverse proxy can keep mode-less searches on
SearXNG and send requests containing `optimizationMode` to Winggo.

## Request

```http
GET /search?q=<query>&format=json&categories=general&pageno=1&language=ko&time_range=month&engines=google,bing&optimizationMode=quality
Authorization: Bearer <proxy-token>
```

Supported query parameters:

- `q` (required)
- `format` (`json` only for AI searches; defaults to `json`)
- `categories` (comma-separated)
- `pageno` (positive integer)
- `language`
- `time_range` (`day`, `month`, or `year`)
- `engines` (comma-separated)
- `optimizationMode` (`speed`, `balanced`, or `quality`)

Model identifiers are not accepted. Winggo selects the first available chat
model and the first available embedding model. The two models may belong to
different providers. The selection is cached for 60 seconds.

When `language=ko`, Winggo passes `ko` to SearXNG and asks the writer model to
answer in Korean.

## Response

```json
{
  "query": "Winggo architecture",
  "optimizationMode": "quality",
  "answer": "The generated AI answer...",
  "results": [
    {
      "title": "Source title",
      "url": "https://example.com/source",
      "content": "Relevant source content"
    }
  ],
  "meta": {
    "requestId": "b8f3b51d-ff58-4b31-baf4-1a4bc399dd7d",
    "elapsedMs": 12450
  }
}
```

Mode deadlines are 45 seconds for `speed`, 90 seconds for `balanced`, and 180
seconds for `quality`. Validation errors return 400, missing default models
return 503, timeouts return 504, and AI pipeline failures return 502. Error
responses include the same diagnostic `requestId` shape as successful calls.

## Caddy routing

The public proxy must authenticate requests before routing them. Match the
presence of `optimizationMode`, not only valid values, so Winggo can return a
consistent 400 response for invalid modes.

```caddyfile
:8088 {
	@ai_search {
		header Authorization "Bearer {$SEARX_PROXY_TOKEN}"
		method GET
		path /search
		query optimizationMode
	}
	handle @ai_search {
		# Rewriting only the path retains the original query string.
		rewrite * /api/search/compat
		reverse_proxy winggo:3000 {
			transport http {
				response_header_timeout 190s
				dial_timeout 5s
			}
		}
	}

	@searxng_search {
		header Authorization "Bearer {$SEARX_PROXY_TOKEN}"
		method GET
		path /search
	}
	handle @searxng_search {
		reverse_proxy winggo:8080
	}

	respond "unauthorized" 401
}
```

Replace `winggo` with the deployment's actual container DNS name. Requests
without `optimizationMode` retain the original path, query string, SearXNG
response body, and status code.

## Examples

Unchanged SearXNG request:

```bash
curl -H "Authorization: Bearer $SEARX_PROXY_TOKEN" \
  "$SEARXNG_URL/search?q=winggo&format=json&language=ko"
```

AI search using every supported option:

```bash
curl -H "Authorization: Bearer $SEARX_PROXY_TOKEN" \
  "$SEARXNG_URL/search?q=winggo&format=json&categories=general&pageno=1&language=ko&time_range=month&engines=google,bing&optimizationMode=quality"
```

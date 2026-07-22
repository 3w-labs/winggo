# Winggo `optimizationMode` 운영 배포 이관

작성일: 2026-07-22  
대상 저장소: `3w-labs/winggo`  
배포 커밋: `9d1658b655791ff03ff18cbf9785efa19143b392`

## 1. 변경 사항

외부 SearXNG 호환 요청에서 `optimizationMode`가 지정되면 Winggo가 검색부터
최종 AI 답변 생성까지 수행한다.

```text
GET /search?...                              -> SearXNG :8080
GET /search?...&optimizationMode=speed       -> Winggo :3000/api/search/compat
GET /search?...&optimizationMode=balanced    -> Winggo :3000/api/search/compat
GET /search?...&optimizationMode=quality     -> Winggo :3000/api/search/compat
```

Winggo 호환 API는 다음 외부 파라미터를 받는다.

- `q`
- `format`
- `categories`
- `pageno`
- `language`
- `time_range`
- `engines`
- `optimizationMode`: `speed`, `balanced`, `quality`

모델명은 외부에서 받지 않는다. Winggo 서버에 설정된 기본 chat 모델과 embedding
모델을 사용한다.

## 2. 현재 상태

- `master`에 커밋 `9d1658b` push 완료
- GitHub Actions 실행 `29901103264` 성공
- 첫 번째 GHCR 이미지 발행 완료
  - `ghcr.io/3w-labs/winggo:latest`
  - `ghcr.io/3w-labs/winggo:slim-latest`
- Caddy의 `optimizationMode` 분기는 운영 서버에 반영된 것으로 확인됨
- 첫 번째 새 full 이미지는 가변 SearXNG upstream HEAD와 커스텀 엔진의 호환성
  오류로 SearXNG가 기동하지 못해 이전 이미지로 롤백함
- 롤백 후 일반 SearXNG 검색 HTTP 200을 재확인함
- 정상 이미지의 SearXNG commit
  `b5ef7ec8f32b7020cc0f887e26f0d01b85949d17`을 Dockerfile에 고정함
- 고정 버전 이미지의 GitHub Actions 빌드, pull, 재기동 및 AI 검색 검증이 남아 있음

운영에는 SearXNG가 포함된 `latest` full 이미지를 사용한다. `slim-latest`는 현재
구조에서 SearXNG `:8080`을 제공하지 않으므로 대체하면 안 된다.

SearXNG 버전을 임의로 upstream HEAD로 되돌리면 안 된다. 커스텀
`fmkorea_google.py`가 최신 SearXNG에서 제거된 `gen_gsa_useragent`를 import해
기동을 중단시키는 장애가 확인됐다. 고정 SHA 변경은 별도 호환 테스트를 통과한 뒤에만
수행한다.

## 3. 운영 구성

### Winggo/Vane

- 서버: 도쿄 OCI `161.33.208.131`
- 호스트: `a1-4c-24g-tokyo`
- Compose 디렉터리: `~/Perplexica`
- Compose 서비스: `vane`
- 컨테이너: `perplexica-vane-1`
- 이미지: `ghcr.io/3w-labs/winggo:latest`
- Winggo 포트: `3000`
- SearXNG 포트: `8080`

### 검색 프록시

- Compose 디렉터리: `~/searx-proxy`
- Caddyfile: `~/searx-proxy/Caddyfile`
- 컨테이너 내부 Caddyfile: `/etc/caddy/Caddyfile`
- 컨테이너: `searx-proxy`
- 외부 검색 게이트: `http://161.33.208.131:8088`
- Docker 네트워크: `perplexica_default`

## 4. Caddy 설정

운영 `~/searx-proxy/Caddyfile`은 다음 구조여야 한다.

```caddyfile
{
	admin off
	auto_https off
}

:8088 {
	@ai_search {
		header Authorization "Bearer {$SEARX_PROXY_TOKEN}"
		method GET
		path /search
		query optimizationMode=*
	}

	handle @ai_search {
		rewrite * /api/search/compat

		reverse_proxy perplexica-vane-1:3000 {
			transport http {
				dial_timeout 5s
				response_header_timeout 190s
			}
		}
	}

	@authed header Authorization "Bearer {$SEARX_PROXY_TOKEN}"

	handle @authed {
		reverse_proxy perplexica-vane-1:8080
	}

	respond "unauthorized" 401
}
```

검증 및 재시작:

```bash
cd ~/searx-proxy

docker compose exec searx-proxy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker compose restart searx-proxy
docker compose logs --tail=100 searx-proxy
```

전역 설정에 `admin off`가 있으므로 운영에서는 Caddy admin API reload보다 컨테이너
재시작을 사용한다.

## 5. GHCR 인증

GHCR 패키지가 private이므로 운영 서버의 `ubuntu` 사용자 Docker 클라이언트에
로그인이 필요하다.

GitHub classic PAT 요구사항:

- PAT 소유 계정이 `3w-labs/winggo`에 접근 가능
- `read:packages`
- private 저장소 접근을 위한 `repo`
- 조직 SSO를 사용하면 `3w-labs`에 대해 `Configure SSO` 승인

GitHub 비밀번호나 fine-grained PAT가 아닌 classic PAT를 사용한다. 명령의 사용자명은
조직명 `3w-labs`가 아니라 PAT를 발급한 개인 GitHub 계정명이다.

```bash
docker logout ghcr.io

read -rsp "GitHub PAT: " GHCR_TOKEN
echo
read -rp "GitHub username: " GHCR_USERNAME

printf '%s' "$GHCR_TOKEN" | \
  docker login ghcr.io \
    --username "$GHCR_USERNAME" \
    --password-stdin

unset GHCR_TOKEN GHCR_USERNAME
```

GitHub username 프롬프트에는 PAT를 발급한 실제 개인 계정명을 입력한다. 성공 시
`Login Succeeded`가 출력된다. PAT는 명령 인자, 문서, 채팅 또는 셸 기록에 직접
입력하지 않는다.

`docker`와 `sudo docker`를 섞으면 서로 다른 Docker credential 저장소를 사용할 수
있다. 운영 Compose를 실행하는 동일한 사용자로 로그인한다.

## 6. 이미지 pull 및 재기동

기존 컨테이너 이미지 ID를 롤백용으로 기록한다.

```bash
cd ~/Perplexica

docker inspect perplexica-vane-1 \
  --format 'image={{.Config.Image}} id={{.Image}} started={{.State.StartedAt}}'

docker inspect perplexica-vane-1 --format '{{.Image}}' \
  > ~/winggo-previous-image-id
```

새 full 이미지를 받고 `vane`만 재생성한다.

```bash
docker compose pull vane
docker compose up -d --no-deps --force-recreate vane
```

상태와 시작 로그를 확인한다.

```bash
docker compose ps vane
docker compose logs --tail=100 vane
```

## 7. 스모크 테스트

### 7.1 Winggo 직접 호출

먼저 Caddy를 거치지 않고 새 라우트가 존재하는지 확인한다.

```bash
curl --max-time 55 -sS \
  -D /tmp/winggo-direct.headers \
  -o /tmp/winggo-direct.body \
  "http://localhost:3000/api/search/compat?q=winggo&format=json&language=ko&optimizationMode=speed"

head -n 20 /tmp/winggo-direct.headers
head -c 500 /tmp/winggo-direct.body
echo
```

`404`가 아니어야 한다. 모델 또는 upstream 설정 문제라면 JSON 형태의 `502`, `503`,
`504`가 나올 수 있지만, Next.js HTML 404가 나오면 여전히 이전 이미지다.

### 7.2 토큰 로드

```bash
cd ~/searx-proxy
set -a
source .env
set +a

if [ -n "$SEARX_PROXY_TOKEN" ]; then
  echo "token loaded"
else
  echo "token missing"
fi
```

토큰값 자체를 출력하지 않는다.

### 7.3 기존 SearXNG 경로

```bash
curl --max-time 20 -sS \
  -H "Authorization: Bearer $SEARX_PROXY_TOKEN" \
  "http://localhost:8088/search?q=winggo&format=json&language=ko" | \
  jq '{query, resultCount: (.results | length), error}'
```

기대 결과:

- HTTP 200
- `results` 배열 존재
- `answer` 필드 없음

### 7.4 Winggo AI 경로

응답이 JSON이 아닐 때 `jq`가 원인을 가리므로, 첫 검증은 헤더와 본문을 파일로
분리한다.

```bash
curl --max-time 55 -sS \
  -D /tmp/winggo-ai.headers \
  -o /tmp/winggo-ai.body \
  -H "Authorization: Bearer $SEARX_PROXY_TOKEN" \
  "http://localhost:8088/search?q=winggo&format=json&language=ko&optimizationMode=speed"

head -n 20 /tmp/winggo-ai.headers
jq '{query, optimizationMode, answer, resultCount: (.results | length), meta, error}' \
  /tmp/winggo-ai.body
```

기대 결과:

- HTTP 200
- `optimizationMode`가 `speed`
- `answer`가 문자열
- `results`가 배열
- `meta.requestId` 존재

## 8. 오류별 조치

| 증상 | 의미 | 조치 |
|---|---|---|
| `401 unauthorized` | 셸 토큰 미설정 또는 Caddy 토큰 불일치 | `~/searx-proxy/.env`를 로드하고 `SEARX_PROXY_TOKEN` 존재 여부 확인 |
| GHCR `unauthorized` | Docker 미로그인 또는 PAT 권한 부족 | classic PAT의 `read:packages`, `repo`, 조직 SSO 및 개인 계정명 확인 |
| Next.js HTML `404` | Caddy 분기는 됐지만 Winggo가 이전 이미지 | `docker compose pull vane` 후 `--force-recreate` |
| Caddy `502` | `perplexica-vane-1:3000` 연결 실패 | 컨테이너 상태, 포트, `perplexica_default` 네트워크 확인 |
| JSON `503 model_not_configured` | chat 또는 embedding 기본 모델 없음 | Winggo 서버 모델 provider 설정 확인 |
| JSON `504 search_timeout` | 모드별 AI 검색 제한시간 초과 | upstream 상태와 모델 속도 확인 |
| JSON `502 searxng_unavailable` | Winggo 내부 SearXNG 호출 실패 | 컨테이너 내부 `localhost:8080`과 SearXNG 로그 확인 |

## 9. 롤백

재기동 전에 기록한 이전 이미지 ID로 임시 태그를 만들고 Compose에서 해당 태그를
지정해 재생성한다.

```bash
xargs docker tag < ~/winggo-previous-image-id \
  ghcr.io/3w-labs/winggo:rollback
```

`~/Perplexica/docker-compose.yml`의 `vane.image`를 일시적으로
`ghcr.io/3w-labs/winggo:rollback`으로 지정한 뒤 실행한다.

```bash
cd ~/Perplexica
docker compose up -d --no-deps --force-recreate vane
docker compose logs --tail=100 vane
```

롤백 후 일반 검색과 AI 검색을 다시 확인한다. 이전 이미지는 AI 호환 API가 없으므로
Caddy의 `@ai_search` 분기도 함께 되돌리지 않으면 AI 요청은 404가 된다.

## 10. 완료 조건

- GHCR `latest` pull 성공
- `vane` 컨테이너가 새 이미지로 재생성됨
- 기존 `/search` 요청 HTTP 200 및 SearXNG JSON 확인
- `optimizationMode=speed` 요청 HTTP 200 및 Winggo 확장 JSON 확인
- 무인증 요청 HTTP 401 확인
- 운영 로그에 반복적인 startup, SearXNG, model provider 오류가 없음

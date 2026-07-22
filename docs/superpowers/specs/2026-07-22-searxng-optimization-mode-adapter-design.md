# SearXNG optimizationMode 호환 어댑터 설계

## 목표

기존 SearXNG 호환 `GET /search` 계약을 유지하면서 선택적인
`optimizationMode=speed|balanced|quality` 파라미터로 Winggo의 AI 검색
파이프라인을 실행한다. 모드가 없는 요청은 기존 SearXNG로 그대로 전달해
현재 클라이언트와 응답을 변경하지 않는다.

## 외부 API 계약

허용하는 쿼리 파라미터는 다음과 같다.

- `q`: 필수 검색어
- `format`: AI 모드에서는 `json`만 허용
- `categories`: 쉼표로 구분한 SearXNG 카테고리
- `pageno`: 1 이상의 정수
- `language`: SearXNG 검색 언어
- `time_range`: `day`, `month`, `year` 중 하나
- `engines`: 쉼표로 구분한 SearXNG 엔진
- `optimizationMode`: `speed`, `balanced`, `quality` 중 하나

모델 식별자는 외부 파라미터로 받지 않는다. 어댑터가 Winggo의 활성 Provider
목록에서 첫 번째 사용 가능한 채팅 모델과 첫 번째 사용 가능한 임베딩 모델을
기본 모델로 선택한다.

AI 모드의 성공 응답은 기존 검색 결과를 수용할 수 있는 확장 형식이다.

```json
{
  "query": "검색어",
  "optimizationMode": "quality",
  "answer": "Winggo가 생성한 최종 AI 답변",
  "results": [
    {
      "title": "출처 제목",
      "url": "https://example.com",
      "content": "출처 내용"
    }
  ],
  "meta": {
    "requestId": "uuid",
    "elapsedMs": 12345
  }
}
```

`results`는 Winggo의 `sources`를 SearXNG 유사 구조로 변환한 값이다. 기존
필드에 `answer`, `optimizationMode`, `meta`를 확장 필드로 추가한다.

## 라우팅

Caddy는 Bearer 토큰을 먼저 검증한 뒤 다음과 같이 분기한다.

```text
GET /search + optimizationMode 없음
  -> URI를 변경하지 않고 SearXNG :8080

GET /search + optimizationMode 파라미터 존재
  -> /api/search/compat로 경로를 바꾸어 Winggo :3000

POST /api/search
  -> 기존과 동일하게 Winggo :3000
```

값이 유효하지 않더라도 `optimizationMode`가 존재하면 어댑터로 보내 Winggo가
일관된 `400 invalid_optimization_mode`를 반환하게 한다. `/api/providers`를
포함한 나머지 Winggo API는 외부에 공개하지 않는다. 토큰이 없거나 일치하지
않는 요청은 기존과 동일하게 `401`로 차단한다.

## Winggo 구성

### GET 호환 엔드포인트

Winggo에 `GET /api/search/compat`를 추가한다. 이 엔드포인트의 책임은 다음과
같다.

1. 외부 쿼리 파라미터를 파싱하고 검증한다.
2. `ModelRegistry`에서 기본 채팅 및 임베딩 모델을 선택한다.
3. 공통 AI 검색 서비스를 호출한다.
4. Winggo 결과를 확장 응답 형식으로 변환한다.

첫 번째 활성 Provider에 채팅 모델이 없더라도 다음 Provider를 계속 탐색한다.
임베딩 모델도 같은 방식으로 독립적으로 선택하므로 두 모델의 Provider가 달라도
된다. 사용할 수 있는 모델이 없으면 `503 model_not_configured`를 반환한다.

### 공통 검색 서비스

기존 `POST /api/search`의 AI 검색 실행 로직을 라우트 밖의 공통 서비스로
분리한다. 기존 POST와 새 GET 어댑터가 동일 서비스를 호출해 모드별 동작과
응답 수집 로직이 갈라지지 않게 한다.

서비스 입력에 다음 SearXNG 옵션을 추가한다.

```ts
type SearchOptions = {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
};
```

연구 에이전트가 실행하는 각 SearXNG 검색에 같은 옵션을 전달한다. `language=ko`
이면 검색 언어를 보존하는 동시에 시스템 지침에 한국어 답변 요구를 추가한다.
사용자가 제공한 다른 시스템 지침이 있다면 덮어쓰지 않고 병합한다.

`pageno`는 Winggo가 생성한 각 검색어에 동일하게 적용한다. `categories`와
`engines`는 쉼표 구분 문자열을 배열로 변환한 뒤 SearXNG 호출 시 다시 표준
쉼표 구분 파라미터로 직렬화한다.

## 호환성

- `optimizationMode`가 없는 요청은 기존 Caddy 및 SearXNG 경로만 거친다.
- 기존 SearXNG 요청의 URI, 쿼리, 상태 코드 및 응답 본문을 변경하지 않는다.
- AI 모드에서도 `q`, `format`, `categories`, `pageno`, `language`,
  `time_range`, `engines`의 의미를 보존한다.
- 알 수 없는 외부 파라미터는 Winggo로 전달하지 않는다.
- 모델 선택 파라미터는 허용하지 않아 외부 호출자가 운영 모델을 변경하지
  못하게 한다.

## 오류 처리

오류 응답은 일관된 JSON 형식을 사용한다.

```json
{
  "error": {
    "code": "winggo_search_failed",
    "message": "AI 검색 처리에 실패했습니다."
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

오류 매핑은 다음과 같다.

- 인증 실패: `401`
- `q` 누락: `400 missing_query`
- 잘못된 `optimizationMode`: `400 invalid_optimization_mode`
- 잘못된 `format`, `pageno`, `time_range`: `400`과 해당 오류 코드
- 기본 모델 미설정: `503 model_not_configured`
- SearXNG 장애: `502 searxng_unavailable`
- Winggo 검색 실패: `502 winggo_search_failed`
- 모드별 제한 시간 초과: `504 search_timeout`

모든 AI 모드 응답에 `requestId`를 포함하고 서버 로그에도 같은 값을 기록한다.
클라이언트가 연결을 종료하면 진행 중인 검색도 취소한다. 내부 오류나 설정 값은
외부 메시지에 노출하지 않는다.

## 제한 시간과 캐시

- `speed`: 45초
- `balanced`: 90초
- `quality`: 180초
- Caddy `response_header_timeout`: quality 상한보다 큰 190초 이상

기본 모델 탐색 결과는 60초 동안 프로세스 메모리에 캐시한다. Provider 설정이
바뀐 뒤 최대 60초 내에 새 모델 선택이 반영된다. AI 검색 결과는 최신성과 쿼리
다양성을 보존하기 위해 기본적으로 캐시하지 않는다.

## 테스트

Winggo 테스트는 다음을 검증한다.

- 세 모드의 파싱과 공통 검색 서비스 전달
- 기존 일곱 개 SearXNG 파라미터의 파싱, 검증 및 손실 없는 전달
- 기본 채팅 및 임베딩 모델의 독립적인 자동 선택과 60초 캐시
- `language=ko`의 검색 옵션 및 한국어 답변 지침 병합
- Winggo `sources`에서 확장 `results`로의 변환
- 잘못된 값, 모델 미설정, upstream 오류 및 타임아웃 응답
- 클라이언트 취소 신호 전파

Caddy 검증은 다음을 포함한다.

- 모드 없는 GET 요청이 기존 SearXNG upstream으로 전달됨
- 모드 파라미터가 있는 GET 요청이 Winggo 호환 엔드포인트로 전달됨
- 잘못된 모드도 SearXNG로 빠지지 않고 어댑터에서 `400`으로 거부됨
- 기존 POST `/api/search`가 계속 동작함
- Bearer 토큰 누락 및 불일치가 `401`로 차단됨
- quality 요청에 충분한 upstream 제한 시간이 적용됨

운영 스모크 테스트는 동일 검색어로 기존 GET과 세 AI 모드를 각각 호출해 응답
스키마, 모드, 출처 및 한국어 응답을 확인한다.

## 변경 범위

`winggo` 저장소에 GET 호환 엔드포인트, 공통 AI 검색 서비스, SearXNG 옵션
전달 및 테스트를 추가한다. 배포 환경에서는 Caddy 라우팅과 제한 시간을 이
설계에 맞게 조정한다. SearXNG 코어와 설정은 수정하지 않는다.

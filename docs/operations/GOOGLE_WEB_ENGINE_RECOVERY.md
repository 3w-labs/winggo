# Google 웹 엔진 복구 노트

작성일: 2026-07-29  
대상 SearXNG 핀:
`b5ef7ec8f32b7020cc0f887e26f0d01b85949d17`

## 결론

`SEARXNG_REF`는 유지하고, 이미지에 `google_cse.py`를 오버레이한 뒤 settings의
엔진 이름 `google`을 이 모듈에 연결했다. `fmkorea_google.py`도 같은 CSE 요청
빌더와 응답 파서를 재사용한다.

기존 `searx.engines.google` 모듈은 덮어쓰지 않았다. Google Images, News,
Scholar 등 정상 동작 중인 vertical 엔진이 이 모듈의 locale/traits 함수를
공유하기 때문이다. `optimizationMode`를 처리하는 Winggo/compat 경로와 기존
naver/tistory/dcinside/clien 오버레이도 수정하지 않았다.

## 선택 근거와 트레이드오프

### A. SearXNG 핀 상향

선택하지 않았다. 2026-07-04 upstream 커밋 `1cdf01a71`은 기존 Google HTML
엔진을 `completely broken`이라고 설명하고, 파서 수리가 아닌 별도 Google CSE
엔진을 대안으로 추가했다. 2026-07-05 `fd5eb84a3`도 GSA UA가 더 이상
동작하지 않으며 Google HTML/video 엔진이 여전히 동작하지 않는다고 기록한다.
따라서 최신 핀으로 올려도 `google` HTML 엔진은 살아나지 않는다.

핀 상향은 이전 배포에서 확인된 `gen_gsa_useragent` 제거에 따른 커스텀 엔진
기동 실패도 다시 가져온다. 상향을 택하려면 최소한 full image 기동,
`optimizationMode` 세 모드의 compat 응답, 모든 한국 엔진, Google vertical
엔진을 대상으로 별도 호환 매트릭스를 통과해야 한다. 이번 변경은 그 위험을
만들지 않도록 핀을 그대로 뒀다.

### B. Google HTML 엔진 오버레이

선택하지 않았다. 개발 환경에서 다음 조합을 직접 호출했으나 모두 HTTP 200,
약 91 KB, 결과 `<h3>` 0개, 결과용 `data-ved` anchor 0개인 스텁이었다.

- 일반 desktop/Firefox UA
- 기존 GSA UA
- `udm=14`
- `gbv=1`
- `client=firefox-b-d`
- `udm=14&client=firefox-b-d`

desktop 계열 응답에는 `enablejs`가 포함됐다. UA나 파라미터 하나만 바꾸는 안은
현재 환경에서 결과 추출을 입증할 수 없었다.

### C. 핀 유지 + Google CSE 오버레이

선택했다. upstream SearXNG가 깨진 HTML 엔진의 대안으로 채택한 공개 Blackle
Programmable Search Engine을 사용한다. Google CSE element endpoint는 JSONP로
제목, URL, 본문을 제공하므로 JavaScript를 실행할 필요가 없다.

트레이드오프는 공개 CSE ID와 token endpoint에 의존한다는 점이다. upstream
설명상 현재 CSE 방식은 2027년에 Google 변경 영향을 받을 예정이다. token이나
result 응답이 HTML/JS 스텁, CAPTCHA, malformed JSONP, 또는 `results` 필드가
없는 응답이면 빈 배열로 삼키지 않고 SearXNG 엔진 예외를 던지도록 했다.
명시적인 `results: []`만 정상 0건으로 처리한다.

## 개발 환경 네트워크 검증

운영 서버에는 접속하지 않았다. 2026-07-29 개발 환경에서 다음 두 endpoint를
직접 호출했다. 실제 `cse_tok` 값은 기록하지 않았다.

```text
GET https://www.google.com/cse/cse.js?cx=<CX>
GET https://cse.google.com/cse/element/v1?rsz=filtered_cse&num=20&hl=en&cx=<CX>&q=<QUERY>&safe=off&cse_tok=<REDACTED>&callback=_&searchtype=
```

측정 결과:

| Query | token HTTP | result HTTP | 추출 건수 | 제목·URL·본문 완비 |
| --- | ---: | ---: | ---: | ---: |
| `openai` | 200 | 200 | 20 | 20 |
| `site:fmkorea.com openai` | 200 | 200 | 20 | 20 |

일반 검색의 첫 세 host는 `openai.com`, `chatgpt.com`,
`www.linkedin.com`이었다. FMKorea 검색의 첫 세 host는 모두
`www.fmkorea.com`이었다.

이 검증은 개발 환경의 한 시점에 대한 smoke test이며 배포 후 가용성을 보장하지
않는다. 회귀 검증은 네트워크 비의존 JSONP/JS-stub fixture 테스트로 고정했다.

## 배포 후 확인 항목

이미지 배포 후 다음 두 요청을 각각 확인한다.

```text
/search?q=openai&format=json&engines=google
/search?q=openai&format=json&engines=fmkorea
```

정상 시 `results`에 제목·URL·본문이 채워져야 한다. upstream 차단 또는 CSE
응답 형식 장애 시에는 `results: []`만 조용히 반환하는 대신
`unresponsive_engines`에 해당 엔진이 나타나야 한다.


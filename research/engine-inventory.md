# SearXNG 엔진 인벤토리 (활성 99개)

> 작성일: 2026-07-01
> 출처: 배포 SearXNG(`perplexica-vane-1`) `/config` 엔드포인트 실측. `use_default_settings: true`라 기본 엔진 대거 활성.
> 관련: [04-naver-scraper-blocking-poc.md](./04-naver-scraper-blocking-poc.md) · [05-naver-api-vs-scraping.md](./05-naver-api-vs-scraping.md)
> 별첨: [06-engine-inventory.csv](./06-engine-inventory.csv) (99행, 정렬·필터용)

---

## 1. 핵심 요약

- 활성 엔진 **99개** (전체 280개 중). 카테고리별로 발화하므로 한 검색에 전부 도는 건 아님.
- 한국 소스는 **14개**: **네이버 13 + 구글 1(fmkorea)**.
- 이 중 **10개**(naver, naver blog, tistory + 커뮤니티 7)가 `general` 카테고리라 **일반검색마다 `search.naver.com` 동시 타격** → fan-out 차단의 원인([04](./04-naver-scraper-blocking-poc.md)).

---

## 2. 한국 소스 14개 — 색인 출처별 (실행 대상)

### 🟢 네이버 색인 (13) — 전부 직접 스크래핑

| 엔진 (shortcut)      | 방식                    | 일반검색 발화 | 이전안(권장) |
| -------------------- | ----------------------- | :-----------: | ------------ |
| naver `!nvr`         | 직접 스크래핑           |      🔴       | 네이버 API   |
| naver blog `!nvrb`   | 직접 스크래핑           |      🔴       | 네이버 API   |
| tistory `!tis`       | `site:tistory.com`      |      🔴       | 구글 경유    |
| dcinside `!dci`      | `site:dcinside.com`     |      🔴       | 구글 경유    |
| clien `!cli`         | `site:clien.net`        |      🔴       | 구글 경유    |
| ruliweb `!ruli`      | `site:ruliweb.com`      |      🔴       | 구글 경유    |
| theqoo `!tq`         | `site:theqoo.net`       |      🔴       | 구글 경유    |
| ppomppu `!ppom`      | `site:ppomppu.co.kr`    |      🔴       | 구글 경유    |
| instiz `!ins`        | `site:instiz.net`       |      🔴       | 구글 경유    |
| bobaedream `!bobae`  | `site:bobaedream.co.kr` |      🔴       | 구글 경유    |
| naver images `!nvri` | 직접 스크래핑           |   탭에서만    | 네이버 API   |
| naver news `!nvrn`   | 직접 스크래핑           |   탭에서만    | 네이버 API   |
| naver videos `!nvrv` | 직접 스크래핑           |   탭에서만    | 네이버 API   |

### 🔵 구글 색인 (1)

| 엔진 (shortcut) | 방식               | 일반검색 발화 | 이전안 |
| --------------- | ------------------ | :-----------: | ------ |
| fmkorea `!fmk`  | `site:fmkorea.com` |       —       | 유지   |

> 🔴 = 일반검색마다 `search.naver.com` 동시 요청(fan-out). 10개가 동시에 몰려 2질의(~20동시)에 403 차단.

---

## 3. 전체 99개 — 색인 출처별 그룹

| 색인 출처              |   개수 |  한국  | 엔진                                                                                                                              |
| ---------------------- | -----: | :----: | --------------------------------------------------------------------------------------------------------------------------------- |
| 네이버                 |     13 |   🇰🇷   | naver, naver blog, naver images, naver news, naver videos, tistory, dcinside, clien, ruliweb, theqoo, ppomppu, instiz, bobaedream |
| 구글                   |      9 |  🇰🇷¹   | google, google images, google news, google scholar, google videos, startpage, startpage images, startpage news, fmkorea           |
| Bing                   |      3 |   —    | bing images, bing news, bing videos                                                                                               |
| DuckDuckGo (Bing 기반) |      4 |   —    | duckduckgo, ddg images, ddg news, ddg videos                                                                                      |
| Brave (자체색인)       |      4 |   —    | brave, brave.images, brave.news, brave.videos                                                                                     |
| 위키미디어             |      8 |   —    | wikipedia, wikidata, wikinews, wiktionary, wikicommons.audio/files/images/videos                                                  |
| 학술 DB                |      6 |   —    | arxiv, pubmed, semantic scholar, openairedatasets, openairepublications, pdbe                                                     |
| IT/개발                |     12 |   —    | github, stackoverflow, superuser, askubuntu, docker hub, pypi, mdn, mankier, hoogle, arch linux wiki, gentoo, devicons            |
| 이미지 서비스          |      8 |   —    | flickr, deviantart, pinterest, unsplash, pexels, openverse, artic, lucide                                                         |
| 비디오 서비스          |      4 |   —    | youtube, vimeo, dailymotion, sepiasearch                                                                                          |
| 음악 서비스            |      5 |   —    | bandcamp, genius, mixcloud, soundcloud, radio browser                                                                             |
| 파일/토렌트            |      4 |   —    | bt4g, kickass, piratebay, solidtorrents                                                                                           |
| 지도                   |      2 |   —    | openstreetmap, photon                                                                                                             |
| 소셜(분산형)           |      7 |   —    | lemmy posts/comments/communities/users, mastodon hashtags/users, tootfinder                                                       |
| 번역/사전              |      5 |   —    | dictzone, lingva, mymemory translated, etymonline, wordnik                                                                        |
| 기타                   |      5 |   —    | wolframalpha, currency, reuters, wttr.in, chefkoch                                                                                |
| **합계**               | **99** | **14** |                                                                                                                                   |

¹ 구글 그룹 중 한국 소스는 fmkorea 1개뿐.

---

## 4. 시사점

- 한국 콘텐츠 14개 중 **13개가 네이버 직접 스크래핑** → 차단·편차·유지보수 취약의 근원.
- **이전안:** 네이버 자산(웹/블로그/이미지/뉴스/비디오)은 **네이버 오픈 API**로, 티스토리·외부 커뮤니티는 **구글 `site:`(fmkorea 방식)** 로 이전 → `general` 발화 🔴 10개를 크게 축소. ([05](./05-naver-api-vs-scraping.md) 하이브리드 원칙)
- 나머지 85개(위키·학술·이미지·비디오 등)는 전용 카테고리/bang에서만 발화하므로 일반검색 fan-out과 무관. 불필요하면 비활성화로 노이즈·부하 축소 가능.

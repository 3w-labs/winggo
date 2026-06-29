import { searchSearxng } from '@/lib/searxng';

const websitesForTopic: Record<string, {
  query: string[];
  links?: string[];
  engines?: string[];
  language?: string;
}> = {
  // 영어 토픽 (기존)
  tech: {
    query: ['technology news', 'latest tech', 'AI', 'science and innovation'],
    links: ['techcrunch.com', 'wired.com', 'theverge.com'],
    engines: ['bing news'],
    language: 'en',
  },
  finance: {
    query: ['finance news', 'economy', 'stock market', 'investing'],
    links: ['bloomberg.com', 'cnbc.com', 'marketwatch.com'],
    engines: ['bing news'],
    language: 'en',
  },
  art: {
    query: ['art news', 'culture', 'modern art', 'cultural events'],
    links: ['artnews.com', 'hyperallergic.com', 'theartnewspaper.com'],
    engines: ['bing news'],
    language: 'en',
  },
  sports: {
    query: ['sports news', 'latest sports', 'cricket football tennis'],
    links: ['espn.com', 'bbc.com/sport', 'skysports.com'],
    engines: ['bing news'],
    language: 'en',
  },
  entertainment: {
    query: ['entertainment news', 'movies', 'TV shows', 'celebrities'],
    links: ['hollywoodreporter.com', 'variety.com', 'deadline.com'],
    engines: ['bing news'],
    language: 'en',
  },

  // 한국어 토픽 (추가)
  korea: {
    query: ['한국 뉴스', '오늘의 뉴스', '사회 정치', '최신 이슈'],
    engines: ['naver news'],
    language: 'ko',
  },
  'tech-kr': {
    query: ['IT 뉴스', '테크', '인공지능', '반도체', '한국 IT'],
    links: ['zdnet.co.kr', 'itworld.co.kr', 'thelec.kr'],
    engines: ['naver news'],
    language: 'ko',
  },
  'finance-kr': {
    query: ['경제 뉴스', '주식', '금융', '한국 경제'],
    links: ['mk.co.kr', 'hankyung.com'],
    engines: ['naver news'],
    language: 'ko',
  },
  'entertainment-kr': {
    query: ['연예 뉴스', '드라마', '영화', 'K팝', '아이돌'],
    engines: ['naver news'],
    language: 'ko',
  },
  'sports-kr': {
    query: ['스포츠 뉴스', 'K리그', '프로야구', '축구', '농구'],
    engines: ['naver news'],
    language: 'ko',
  },
};

type Topic = keyof typeof websitesForTopic;

function normalizeResult(item: any) {
  // SearXNG 결과에서 thumbnail을 유연하게 추출
  const thumbnail =
    item.thumbnail ||
    item.img_src ||
    item.thumbnail_src ||
    '';

  return {
    title: item.title || '',
    content: item.content || '',
    url: item.url || '',
    thumbnail,
  };
}

export const GET = async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;

    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic: Topic = (params.get('topic') as Topic) || 'korea';

    const selected = websitesForTopic[topic] || websitesForTopic['korea'];
    const engines = selected.engines || ['bing news'];
    const language = selected.language || 'en';
    const useSiteFilter = !!(selected.links && selected.links.length > 0 && !engines.includes('naver news'));

    let rawResults: any[] = [];

    if (mode === 'normal') {
      const seenUrls = new Set();

      const searchPromises: Promise<any[]>[] = [];

      // 한국 토픽 또는 naver news 사용 시 더 유연하게 검색
      if (!useSiteFilter) {
        // 한국 뉴스 중심: site 제한 없이 좋은 쿼리로 검색
        for (const q of selected.query) {
          searchPromises.push(
            (async () => {
              const res = await searchSearxng(q, {
                engines,
                pageno: 1,
                language,
              });
              return res.results || [];
            })()
          );
        }
      } else {
        // 영어 토픽: 기존 site: 방식
        selected.links!.forEach((link) => {
          selected.query.forEach((q) => {
            searchPromises.push(
              (async () => {
                const res = await searchSearxng(`site:${link} ${q}`, {
                  engines,
                  pageno: 1,
                  language,
                });
                return res.results || [];
              })()
            );
          });
        });
      }

      rawResults = (
        await Promise.all(searchPromises)
      )
        .flat()
        .map(normalizeResult)
        .filter((item) => {
          if (!item.url) return false;
          const url = item.url.toLowerCase().trim();
          if (seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
        })
        .sort(() => Math.random() - 0.5);
    } else {
      // preview 모드
      let q = selected.query[Math.floor(Math.random() * selected.query.length)];

      if (useSiteFilter && selected.links && selected.links.length > 0) {
        const link = selected.links[Math.floor(Math.random() * selected.links.length)];
        q = `site:${link} ${q}`;
      }

      const res = await searchSearxng(q, {
        engines,
        pageno: 1,
        language,
      });

      rawResults = (res.results || []).map(normalizeResult);
    }

    // thumbnail 있는 결과 우선, 부족하면 전체 반환 (프론트에서 필터)
    const withThumbs = rawResults.filter((r) => r.thumbnail);
    const final = withThumbs.length > 3 ? withThumbs : rawResults;

    return Response.json(
      {
        blogs: final,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error(`An error occurred in discover route: ${err}`);
    return Response.json(
      {
        message: 'An error has occurred',
      },
      {
        status: 500,
      },
    );
  }
};

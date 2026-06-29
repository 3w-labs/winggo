const FALLBACK_TRENDS = [
  '나무위키',
  '대한민국',
  'LCK',
  '차은우',
  '이재명',
  '아이브',
  '삼성전자',
  '날씨',
  '비트코인',
  '프로야구',
];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const res = await fetch('https://soup.anteater-lab.link/api/', {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      throw new Error(`Trending request failed: ${res.status}`);
    }

    const [items, updatedAt] = await res.json();
    const trends = (Array.isArray(items) ? items : [])
      .map((item) => item?.keyword)
      .filter((keyword): keyword is string => typeof keyword === 'string')
      .slice(0, 10);

    return Response.json({
      trends: trends.length > 0 ? trends : FALLBACK_TRENDS,
      updatedAt: updatedAt || null,
    });
  } catch (err) {
    console.error('Failed to load trending keywords:', err);
    return Response.json({
      trends: FALLBACK_TRENDS,
      updatedAt: null,
    });
  }
};

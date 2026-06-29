'use client';

import { useChat } from '@/lib/hooks/useChat';
import { TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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

const TrendingSearchWidget = () => {
  const { loading, sendMessage } = useChat();
  const [trends, setTrends] = useState(FALLBACK_TRENDS);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    fetch('/api/trending')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.trends) && data.trends.length > 0) {
          setTrends(data.trends);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setOffset((current) => (current + 1) % trends.length);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [trends.length]);

  const visibleTrends = useMemo(() => {
    return Array.from({ length: 3 }, (_, i) => {
      const rank = ((offset + i) % trends.length) + 1;
      return {
        rank,
        keyword: trends[(offset + i) % trends.length],
      };
    });
  }, [offset, trends]);

  return (
    <div className="bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 w-full h-24 min-h-[96px] max-h-[96px] px-4 py-3 overflow-hidden">
      <div className="flex items-center gap-2 text-black/70 dark:text-white/70">
        <TrendingUp size={16} className="text-sky-500" />
        <span className="text-xs font-semibold">실시간 검색어</span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {visibleTrends.map((trend) => (
          <button
            key={`${trend.rank}-${trend.keyword}`}
            type="button"
            disabled={loading}
            onClick={() => sendMessage(trend.keyword)}
            className="group flex h-5 w-full items-center gap-2 text-left text-xs disabled:cursor-not-allowed"
          >
            <span className="w-4 shrink-0 text-center font-semibold text-sky-500">
              {trend.rank}
            </span>
            <span className="truncate font-medium text-black/85 transition group-hover:text-sky-600 dark:text-white/85 dark:group-hover:text-sky-300">
              {trend.keyword}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TrendingSearchWidget;

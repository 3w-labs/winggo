import { useEffect, useState } from 'react';

interface Article {
  title: string;
  content: string;
  url: string;
  thumbnail: string;
}

const NewsArticleWidget = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/discover?mode=preview')
      .then((res) => res.json())
      .then((data) => {
        const blogs = data.blogs || [];
        const withThumb = blogs.filter((a: Article) => a.thumbnail);
        const pickFrom = withThumb.length > 0 ? withThumb : blogs;
        setArticles(pickFrom);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (articles.length <= 3) return;

    const intervalId = setInterval(() => {
      setPage((current) => (current + 1) % Math.ceil(articles.length / 3));
    }, 10000);

    return () => clearInterval(intervalId);
  }, [articles.length]);

  const visibleArticles =
    articles.length > 0
      ? Array.from({ length: 3 }, (_, i) => {
          return articles[(page * 3 + i) % articles.length];
        }).filter(Boolean)
      : [];

  return (
    <div className="bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 flex flex-col w-full h-24 min-h-[96px] max-h-[96px] px-3 py-2 overflow-hidden">
      {loading ? (
        <div className="animate-pulse flex flex-col gap-2 w-full h-full justify-center">
          <div className="h-3 w-3/4 rounded bg-light-200 dark:bg-dark-200" />
          <div className="h-3 w-2/3 rounded bg-light-200 dark:bg-dark-200" />
          <div className="h-3 w-4/5 rounded bg-light-200 dark:bg-dark-200" />
        </div>
      ) : error ? (
        <div className="w-full text-xs text-red-400">Could not load news.</div>
      ) : visibleArticles.length > 0 ? (
        <div className="flex h-full flex-col justify-center gap-1">
          {visibleArticles.map((article, index) => (
            <a
              key={`${article.url}-${index}`}
              href={`/?q=Summary: ${article.url}`}
              className="flex h-6 min-h-6 items-center gap-2 overflow-hidden text-xs group"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500/80" />
              <span className="truncate font-medium text-black/85 transition group-hover:text-sky-600 dark:text-white/85 dark:group-hover:text-sky-300">
                {article.title}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default NewsArticleWidget;

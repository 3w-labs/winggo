export type SearchOptions = {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
  safesearch?: 0 | 1 | 2;
};

export const mergeSearxngSearchOptions = (
  configured?: SearchOptions,
  actionSpecific?: SearchOptions,
  realtime = false,
): SearchOptions => ({
  ...configured,
  ...actionSpecific,
  ...(realtime ? { time_range: 'day' as const } : {}),
});

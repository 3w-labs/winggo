export type SiteScope = {
  sites: string[];
};

/**
 * Reduces a user supplied site to a bare hostname.
 *
 * Accepts `https://namu.wiki/w/x`, `www.namu.wiki` or `namu.wiki` and always
 * returns `namu.wiki`. Returns null when nothing usable is left.
 */
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const normalizeSite = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);

    // Credentials in a site would be a copy-paste accident at best.
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const bare = hostname.startsWith('www.') ? hostname.slice(4) : hostname;

    return DOMAIN_PATTERN.test(bare) ? bare : null;
  } catch {
    return null;
  }
};

export const buildSiteQueries = (query: string, sites: string[]): string[] =>
  sites.map((site) => `site:${site} ${query}`);

/**
 * Sites whose own SearXNG engine beats a `site:` web search.
 *
 * Naver and Google index YouTube channel and hashtag pages, not the videos
 * themselves -- a `site:youtube.com` search returns almost no `/watch` URLs.
 * The dedicated engine returns actual videos, so route those sites to it.
 */
export const SITE_ENGINE_OVERRIDES: Record<string, string> = {
  'youtube.com': 'youtube',
};

export type SiteRequest = {
  site: string;
  query: string;
  engines?: string[];
};

/**
 * One search request per requested site.
 *
 * Sites with a dedicated engine get the query verbatim (the engine is already
 * scoped); everything else gets the `site:` prefix and the caller's engines.
 */
export const buildSiteRequests = (
  query: string,
  sites: string[],
): SiteRequest[] =>
  sites.map((site) => {
    const engine = SITE_ENGINE_OVERRIDES[site];

    return engine
      ? { site, query, engines: [engine] }
      : { site, query: `site:${site} ${query}` };
  });

const hostOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * True when the host is the site itself or one of its subdomains.
 *
 * The suffix check is anchored on a dot so `evil-namu.wiki` never matches
 * `namu.wiki` -- the same rule `korean_site_search.py` applies server side.
 */
export const hostMatchesSite = (host: string, site: string): boolean =>
  host === site || host.endsWith(`.${site}`);

/**
 * The most specific requested site the URL belongs to.
 *
 * Longest match wins so overlapping entries (`namu.wiki` and `m.namu.wiki`)
 * land in their own buckets instead of all collapsing into the first one.
 */
export const matchedSite = (
  url: string,
  sites: string[],
): string | undefined => {
  const host = hostOf(url);
  if (!host) return undefined;

  return sites
    .filter((site) => hostMatchesSite(host, site))
    .sort((a, b) => b.length - a.length)[0];
};

/**
 * Drops results that fall outside the requested sites.
 *
 * `site:` is a hint the upstream engine may ignore, so the scope is enforced
 * here as well.
 */
export const filterByDomain = <T>(
  items: T[],
  sites: string[],
  getUrl: (item: T) => string,
): T[] => {
  if (sites.length === 0) return items;
  return items.filter((item) => matchedSite(getUrl(item), sites) !== undefined);
};

/**
 * Spreads `limit` slots evenly across the requested sites.
 *
 * Each site keeps its own ordering; slots are handed out one site at a time in
 * `sites` order. A site that runs out simply stops taking turns, so the others
 * fill the remaining slots and the total never shrinks below what a plain
 * truncation would have returned.
 */
export const balanceByDomain = <T>(
  items: T[],
  sites: string[],
  limit: number,
  getUrl: (item: T) => string,
): T[] => {
  if (limit <= 0) return [];
  if (sites.length === 0) return items.slice(0, limit);

  const buckets = new Map<string, T[]>(sites.map((site) => [site, []]));
  const seenUrls = new Set<string>();

  for (const item of items) {
    const url = getUrl(item);
    if (seenUrls.has(url)) continue;

    const site = matchedSite(url, sites);
    if (!site) continue;

    seenUrls.add(url);
    buckets.get(site)!.push(item);
  }

  const balanced: T[] = [];
  const cursors = new Map<string, number>(sites.map((site) => [site, 0]));

  while (balanced.length < limit) {
    let tookOne = false;

    for (const site of sites) {
      if (balanced.length >= limit) break;

      const bucket = buckets.get(site)!;
      const cursor = cursors.get(site)!;
      if (cursor >= bucket.length) continue;

      balanced.push(bucket[cursor]);
      cursors.set(site, cursor + 1);
      tookOne = true;
    }

    if (!tookOne) break;
  }

  return balanced;
};

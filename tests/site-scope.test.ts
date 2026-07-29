import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceByDomain,
  buildSiteQueries,
  buildSiteRequests,
  filterByDomain,
  normalizeSite,
} from '../src/lib/agents/search/siteScope.ts';

const url = (u: string) => ({ url: u });
const urlOf = (item: { url: string }) => item.url;

test('normalizes sites to a bare hostname', () => {
  assert.equal(normalizeSite('https://namu.wiki/w/아이유'), 'namu.wiki');
  assert.equal(
    normalizeSite('HTTP://WWW.Example.COM:8080/path?q=1#fragment'),
    'example.com',
  );
  assert.equal(normalizeSite('www.Brunch.co.kr'), 'brunch.co.kr');
  assert.equal(normalizeSite('  youtube.com  '), 'youtube.com');
  assert.equal(normalizeSite('namu.wiki:443'), 'namu.wiki');

  // internationalized domains are kept, in the punycode form engines index
  assert.equal(normalizeSite('한글.kr'), 'xn--bj0bj06e.kr');

  assert.equal(normalizeSite(''), null);
  assert.equal(normalizeSite('not-a-domain'), null);
  assert.equal(normalizeSite('https://user:pw@namu.wiki'), null);
  assert.equal(normalizeSite('ftp://namu.wiki'), null);
});

test('buckets overlapping sites by the most specific match', () => {
  const results = [
    url('https://m.namu.wiki/w/a'),
    url('https://namu.wiki/w/b'),
  ];

  const balanced = balanceByDomain(
    results,
    ['namu.wiki', 'm.namu.wiki'],
    2,
    urlOf,
  );

  // m.namu.wiki lands in its own bucket instead of collapsing into namu.wiki
  assert.deepEqual(balanced.map(urlOf), [
    'https://namu.wiki/w/b',
    'https://m.namu.wiki/w/a',
  ]);
});

test('scopes one query per requested site', () => {
  assert.deepEqual(buildSiteQueries('아이유', ['namu.wiki', 'brunch.co.kr']), [
    'site:namu.wiki 아이유',
    'site:brunch.co.kr 아이유',
  ]);

  assert.deepEqual(buildSiteQueries('아이유', []), []);
});

test('keeps only results on the requested sites', () => {
  const results = [
    url('https://namu.wiki/w/a'),
    url('https://m.namu.wiki/w/b'),
    url('https://evil-namu.wiki/w/c'),
    url('https://brunch.co.kr/@x/1'),
    url('https://example.com/d'),
    url('not a url'),
  ];

  const kept = filterByDomain(results, ['namu.wiki', 'brunch.co.kr'], urlOf);

  assert.deepEqual(kept.map(urlOf), [
    'https://namu.wiki/w/a',
    'https://m.namu.wiki/w/b',
    'https://brunch.co.kr/@x/1',
  ]);
});

test('domain filtering accepts HTTP, ports, paths, queries, and host case', () => {
  const results = [
    url('http://NAMU.WIKI:8080/w/a?from=test'),
    url('https://m.NAMU.WIKI/w/b#section'),
    url('https://namu.wiki.evil.example/w/c'),
  ];

  assert.deepEqual(
    filterByDomain(results, ['namu.wiki'], urlOf).map(urlOf),
    results.slice(0, 2).map(urlOf),
  );
});

test('filtering is a no-op when no sites are requested', () => {
  const results = [url('https://example.com/a')];
  assert.deepEqual(filterByDomain(results, [], urlOf), results);
});

test('spreads slots evenly across domains', () => {
  const results = [
    url('https://namu.wiki/1'),
    url('https://namu.wiki/2'),
    url('https://namu.wiki/3'),
    url('https://namu.wiki/4'),
    url('https://brunch.co.kr/1'),
    url('https://brunch.co.kr/2'),
    url('https://youtube.com/1'),
    url('https://youtube.com/2'),
  ];

  const balanced = balanceByDomain(
    results,
    ['namu.wiki', 'brunch.co.kr', 'youtube.com'],
    6,
    urlOf,
  );

  assert.deepEqual(balanced.map(urlOf), [
    'https://namu.wiki/1',
    'https://brunch.co.kr/1',
    'https://youtube.com/1',
    'https://namu.wiki/2',
    'https://brunch.co.kr/2',
    'https://youtube.com/2',
  ]);
});

test('a short domain does not shrink the total', () => {
  const results = [
    url('https://namu.wiki/1'),
    url('https://namu.wiki/2'),
    url('https://namu.wiki/3'),
    url('https://namu.wiki/4'),
    url('https://brunch.co.kr/1'),
  ];

  const balanced = balanceByDomain(
    results,
    ['namu.wiki', 'brunch.co.kr'],
    4,
    urlOf,
  );

  // brunch runs out after one, so namu fills the remaining slots
  assert.equal(balanced.length, 4);
  assert.deepEqual(balanced.map(urlOf), [
    'https://namu.wiki/1',
    'https://brunch.co.kr/1',
    'https://namu.wiki/2',
    'https://namu.wiki/3',
  ]);
});

test('preserves per-domain ordering and drops duplicate URLs', () => {
  const results = [
    url('https://namu.wiki/first'),
    url('https://namu.wiki/first'),
    url('https://namu.wiki/second'),
    url('https://brunch.co.kr/only'),
  ];

  const balanced = balanceByDomain(
    results,
    ['namu.wiki', 'brunch.co.kr'],
    10,
    urlOf,
  );

  assert.deepEqual(balanced.map(urlOf), [
    'https://namu.wiki/first',
    'https://brunch.co.kr/only',
    'https://namu.wiki/second',
  ]);
});

test('never returns more than the limit', () => {
  const results = Array.from({ length: 30 }, (_, i) =>
    url(`https://namu.wiki/${i}`),
  );

  assert.equal(balanceByDomain(results, ['namu.wiki'], 20, urlOf).length, 20);
  assert.equal(balanceByDomain(results, ['namu.wiki'], 0, urlOf).length, 0);
  assert.deepEqual(balanceByDomain([], ['namu.wiki'], 20, urlOf), []);
  assert.deepEqual(
    balanceByDomain(results, [], 2, urlOf).map(urlOf),
    results.slice(0, 2).map(urlOf),
  );
});

test('site order wins even when upstream results arrive in another order', () => {
  const results = [
    url('https://third.example/1'),
    url('https://first.example/1'),
    url('https://second.example/1'),
    url('https://first.example/2'),
    url('https://second.example/2'),
  ];

  assert.deepEqual(
    balanceByDomain(
      results,
      ['first.example', 'second.example', 'third.example'],
      5,
      urlOf,
    ).map(urlOf),
    [
      'https://first.example/1',
      'https://second.example/1',
      'https://third.example/1',
      'https://first.example/2',
      'https://second.example/2',
    ],
  );
});

test('off-site results are excluded from the balance', () => {
  const results = [
    url('https://example.com/spam'),
    url('https://namu.wiki/1'),
  ];

  assert.deepEqual(
    balanceByDomain(results, ['namu.wiki'], 10, urlOf).map(urlOf),
    ['https://namu.wiki/1'],
  );
});

test('sites with a dedicated engine skip the site: prefix', () => {
  const requests = buildSiteRequests('행복주택 전입신고', [
    'namu.wiki',
    'youtube.com',
  ]);

  assert.deepEqual(requests, [
    { site: 'namu.wiki', query: 'site:namu.wiki 행복주택 전입신고' },
    // the youtube engine is already scoped, and web indexes only carry
    // channel/hashtag pages for it
    { site: 'youtube.com', query: '행복주택 전입신고', engines: ['youtube'] },
  ]);
});

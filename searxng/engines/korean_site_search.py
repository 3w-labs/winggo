# SPDX-License-Identifier: AGPL-3.0-or-later
"""Korean public-site search through Naver's web index."""

from urllib.parse import urlencode, urlparse

from lxml import html

from searx.result_types import EngineResults, MainResult
from searx.utils import extract_text

about = {
    "website": "https://search.naver.com",
    "use_official_api": False,
    "require_api_key": False,
    "results": "HTML",
    "language": "ko",
}

categories = ["general", "social media"]
paging = True
language_support = False
time_range_support = False

base_url = "https://search.naver.com"
page_size = 15
site_query = ""
allowed_domains = []


def request(query, params):
    search_terms = query

    if site_query:
        search_terms = f"site:{site_query} {query}"

    query_params = {
        "query": search_terms,
        "where": "web",
        "start": (params["pageno"] - 1) * page_size + 1,
    }

    params["url"] = f"{base_url}/search.naver?{urlencode(query_params)}"
    params["headers"]["User-Agent"] = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "Chrome/120.0 Safari/537.36"
    )
    return params


def response(resp):
    results = EngineResults()
    dom = html.fromstring(resp.text)
    seen_urls = set()

    for item in dom.xpath("//div[contains(@class, 'fds-web-doc-root')]"):
        url = _first_result_url(item)
        if not url or url in seen_urls or not _is_allowed(url):
            continue

        title = _title(item)
        if not title:
            continue

        seen_urls.add(url)
        results.add(
            MainResult(
                title=title,
                url=url,
                content=_content_text(item, title),
            )
        )

    return results


def _first_result_url(item):
    for url in item.xpath(".//a[@href]/@href"):
        if url.startswith("http") and "keep.naver.com" not in url:
            return url

    return None


def _is_allowed(url):
    if not allowed_domains:
        return True

    hostname = urlparse(url).hostname or ""
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in allowed_domains)


def _title(item):
    title = extract_text(
        item.xpath(".//span[contains(@class, 'sds-comps-text-type-headline1')]")
    )

    if title:
        return title

    return extract_text(item.xpath(".//a[@href][1]"))


def _content_text(item, title):
    texts = []

    for text in item.xpath(".//text()"):
        text = " ".join(text.split())
        if text and text != title and text not in texts:
            texts.append(text)

    return " ".join(texts)[:600]

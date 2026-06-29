# SPDX-License-Identifier: AGPL-3.0-or-later
"""Naver Blog search for SearXNG."""

from urllib.parse import urlencode

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
page_size = 10


def request(query, params):
    query_params = {
        "query": query,
        "ssc": "tab.blog.all",
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

    for link in dom.xpath("//a[contains(@href, 'blog.naver.com') and @href]"):
        url = link.get("href")

        if not url or url in seen_urls:
            continue

        title = extract_text(link)
        if not title:
            continue

        seen_urls.add(url)
        block = _result_block(link)
        content = _content_text(block, title)

        results.add(
            MainResult(
                title=title,
                url=url,
                content=content,
            )
        )

    return results


def _result_block(link):
    blocks = link.xpath(
        "ancestor::div[contains(@class, 'sds-comps-base-layout') "
        "or contains(@class, 'sds-comps-vertical-layout')][1]"
    )

    return blocks[0] if blocks else link


def _content_text(block, title):
    texts = []

    for text in block.xpath(".//text()"):
        text = " ".join(text.split())
        if text and text != title and text not in texts:
            texts.append(text)

    return " ".join(texts)[:600]

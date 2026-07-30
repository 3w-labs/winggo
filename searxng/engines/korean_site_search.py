# SPDX-License-Identifier: AGPL-3.0-or-later
"""Korean public-site search through Naver's web index."""

import calendar
import re
from datetime import datetime, timedelta
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
                # None is MainResult's own default, so a block without a date
                # stays indistinguishable from one the engine never dated.
                publishedDate=_published_date(item),
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


# The web tab renders the compact `2026.06.01.` form (56 of 56 labels measured);
# the spaces are tolerated so a padded variant would not silently drop the date.
_ABSOLUTE_DATE = re.compile(r"^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.$")
_RELATIVE_DATE = re.compile(r"^(\d+)(시간|일|주|개월|년) 전$")

# Naver prefixes the description line with the publication label, as its own
# leaf span inside the line's segment container. Measured over five live SERPs
# (71 result blocks): every block carries at most one date-shaped segment, and
# no block yielded a false one. The single class keeps the coupling low --
# the surrounding classes carry obfuscated hashes that rotate, and the
# line-clamp class encodes the number of clamped lines.
_DATE_SEGMENTS = (
    ".//span[contains(concat(' ', normalize-space(@class), ' '), "
    "' sds-comps-text-left ')]//span"
)


def _published_date(item):
    """The publication date of a result block, or None when it carries none.

    Only a segment whose whole text is a date counts, so numbers inside the
    snippet are never mistaken for one -- a wrong date is worse than no date,
    because the consumer's age cutoff acts on it.
    """
    for node in item.xpath(_DATE_SEGMENTS):
        parsed = _parse_published_date(extract_text(node))
        if parsed:
            return parsed

    return None


def _parse_published_date(value, now=None):
    value = " ".join((value or "").split())
    absolute = _ABSOLUTE_DATE.fullmatch(value)
    if absolute:
        try:
            return datetime(*(int(part) for part in absolute.groups()))
        except ValueError:
            return None

    current = now or datetime.now()
    if value == "어제":
        return current - timedelta(days=1)

    relative = _RELATIVE_DATE.fullmatch(value)
    if not relative:
        return None

    amount = int(relative.group(1))
    unit = relative.group(2)
    # Naver's relative labels are coarse: especially hours and larger units do
    # not carry minute/second precision, so the resulting datetime is approximate.
    if unit == "시간":
        return current - timedelta(hours=amount)
    if unit == "일":
        return current - timedelta(days=amount)
    if unit == "주":
        return current - timedelta(weeks=amount)
    if unit == "개월":
        return _shift_months(current, -amount)
    return _shift_years(current, -amount)


def _shift_months(value, months):
    month_index = value.year * 12 + value.month - 1 + months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _shift_years(value, years):
    year = value.year + years
    day = min(value.day, calendar.monthrange(year, value.month)[1])
    return value.replace(year=year, day=day)


def _content_text(item, title):
    texts = []

    for text in item.xpath(".//text()"):
        text = " ".join(text.split())
        if text and text != title and text not in texts:
            texts.append(text)

    return " ".join(texts)[:600]

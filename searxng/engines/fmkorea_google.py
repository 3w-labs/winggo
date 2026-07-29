# SPDX-License-Identifier: AGPL-3.0-or-later
"""FMKorea search through Google's Custom Search web index."""

from urllib.parse import urlparse

from searx.engines import google_cse
from searx.result_types import EngineResults

about = {
    "website": "https://www.fmkorea.com",
    "use_official_api": False,
    "require_api_key": False,
    "results": "HTML",
    "language": "ko",
}

categories = ["general", "social media"]
paging = True
max_page = 5
time_range_support = True
safesearch = True


def request(query, params):
    google_info = {
        "params": {
            "hl": "ko",
            "lr": "lang_ko",
            "cr": "",
        },
        "country": "KR",
        "cookies": {"CONSENT": "YES+"},
        "headers": {"Accept": "*/*"},
    }
    return google_cse.request_with_google_info(
        f"site:fmkorea.com {query}",
        params,
        google_info,
    )


def response(resp):
    results = EngineResults()

    for result in google_cse.response(resp):
        url = result.get("url")
        if not url:
            continue

        hostname = urlparse(url).hostname or ""
        if hostname == "fmkorea.com" or hostname.endswith(".fmkorea.com"):
            results.add(result)

    return results

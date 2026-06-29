# SPDX-License-Identifier: AGPL-3.0-or-later
"""FMKorea search through Google's web index."""

from urllib.parse import urlparse
from urllib.parse import urlencode

from searx.engines import google
from searx.result_types import EngineResults
from searx.utils import gen_gsa_useragent

about = {
    "website": "https://www.fmkorea.com",
    "use_official_api": False,
    "require_api_key": False,
    "results": "HTML",
    "language": "ko",
}

categories = ["general", "social media"]
paging = True
max_page = 50
time_range_support = True
safesearch = True


def request(query, params):
    start = (params["pageno"] - 1) * 10
    params["url"] = "https://www.google.com/search?" + urlencode(
        {
            "q": f"site:fmkorea.com {query}",
            "hl": "ko",
            "filter": "0",
            "start": start,
        }
    )
    params["cookies"]["CONSENT"] = "YES+"
    params["headers"]["User-Agent"] = gen_gsa_useragent()
    return params


def response(resp):
    results = EngineResults()

    for result in google.response(resp):
        url = result.get("url")
        if not url:
            continue

        hostname = urlparse(url).hostname or ""
        if hostname == "fmkorea.com" or hostname.endswith(".fmkorea.com"):
            results.add(result)

    return results

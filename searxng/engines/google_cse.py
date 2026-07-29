# SPDX-License-Identifier: AGPL-3.0-or-later
"""Google web search through the public Custom Search Element endpoint.

This overlay is intentionally compatible with the SearXNG revision pinned by
the Dockerfile.  It replaces only the engine named ``google``; the upstream
``searx.engines.google`` module remains available to Google vertical engines.
"""

from __future__ import annotations

import datetime
import json
import typing as t
from urllib.parse import urlencode

from searx.enginelib import EngineCache
from searx.engines.google import fetch_traits  # pylint: disable=unused-import
from searx.engines.google import filter_mapping, get_google_info
from searx.exceptions import (
    SearxEngineAPIException,
    SearxEngineCaptchaException,
    SearxEngineTooManyRequestsException,
)
from searx.network import get
from searx.result_types import EngineResults

if t.TYPE_CHECKING:
    from searx.extended_types import SXNG_Response
    from searx.search.processors import OnlineParams

about = {
    "website": "https://www.google.com",
    "wikidata_id": "Q2233943",
    "official_api_documentation": "https://developers.google.com/custom-search/docs/element",
    "use_official_api": False,
    "require_api_key": False,
    "results": "JSONP",
}

categories = ["general", "web"]
paging = True
max_page = 5
page_size = 20
time_range_support = True
language_support = True
safesearch = True

# Public Programmable Search Engine used by blackle.com.  This is the same CSE
# selected by upstream SearXNG when its Google HTML engine stopped working.
CX = "partner-pub-8993703457585266:4862972284"

# The name is underscore-prefixed on purpose: ``is_missing_required_attributes()``
# in searx/engines/__init__.py rejects an engine when any *public* module
# attribute is ``None`` at load time, which would set this engine inactive.
_CACHE: EngineCache | None = None


def setup(engine_settings: dict[str, t.Any]) -> bool:
    """Create the engine-scoped persistent token cache."""
    global _CACHE  # pylint: disable=global-statement
    _CACHE = EngineCache(engine_settings["name"])
    return True


def _cache() -> EngineCache:
    global _CACHE  # pylint: disable=global-statement
    if _CACHE is None:
        _CACHE = EngineCache("google")
    return _CACHE


def _cse_token() -> dict[str, str]:
    token: dict[str, str] | None = _cache().get(CX)
    if token:
        return token

    resp = get(f"https://www.google.com/cse/cse.js?cx={CX}", timeout=10)
    if not resp.ok:
        raise SearxEngineAPIException("google cse: failed to obtain token")

    end = resp.text.rfind("});")
    start = resp.text.rfind("({", 0, end)
    if start < 0 or end < 0:
        raise SearxEngineAPIException("google cse: invalid token response")

    try:
        options: dict[str, t.Any] = json.loads(resp.text[start + 1 : end + 1])
    except json.JSONDecodeError as exc:
        raise SearxEngineAPIException("google cse: invalid token JSON") from exc

    cse_token = options.get("cse_token")
    if not cse_token:
        raise SearxEngineAPIException("google cse: token missing")

    experiments = options.get("exp")
    token = {
        "cse_tok": cse_token,
        "cselibv": options.get("cselibVersion", ""),
        "exp": ",".join(experiments) if experiments else "",
    }
    _cache().set(CX, token, expire=3600)
    return token


def _date_range(time_range: str) -> tuple[str, str]:
    days = {"day": 1, "week": 7, "month": 30, "year": 365}[time_range]
    end_date = datetime.datetime.now()
    start_date = end_date - datetime.timedelta(days=days)
    return start_date.strftime("%Y%m%d"), end_date.strftime("%Y%m%d")


def request(query: str, params: "OnlineParams") -> None:
    """Build a JavaScript-free Google CSE JSONP request."""
    return request_with_google_info(query, params, get_google_info(params, traits))


def request_with_google_info(
    query: str,
    params: "OnlineParams",
    google_info: dict[str, t.Any],
) -> None:
    """Build a CSE request with caller-supplied Google locale information."""
    token = _cse_token()
    locale_params: dict[str, str] = google_info["params"]

    args = {
        "rsz": "filtered_cse",
        "num": str(page_size),
        "hl": locale_params["hl"],
        "cselibv": token["cselibv"],
        "cx": CX,
        "q": query,
        "safe": filter_mapping[params["safesearch"]],
        "cse_tok": token["cse_tok"],
        "callback": "_",
        "rurl": "",
        "searchtype": "",
    }

    if params["time_range"]:
        start_date, end_date = _date_range(params["time_range"])
        args["sort"] = f"date:r:{start_date}:{end_date}"
    if locale_params.get("lr"):
        args["lr"] = locale_params["lr"]
    if locale_params.get("cr"):
        args["cr"] = locale_params["cr"]
    if google_info["country"] not in (None, "ZZ"):
        args["gl"] = google_info["country"]
    if token["exp"]:
        args["exp"] = token["exp"]

    start = (params["pageno"] - 1) * page_size
    if start:
        args["start"] = str(start)

    params["url"] = "https://cse.google.com/cse/element/v1?" + urlencode(args)
    params["cookies"] = google_info["cookies"]
    params["headers"].update(google_info["headers"])
    params["headers"]["Referer"] = "https://cse.google.com/"


def _decode_jsonp(text: str) -> dict[str, t.Any]:
    stripped = text.lstrip()
    lowered = stripped.lower()
    if (
        not stripped
        or stripped.startswith("<")
        or "enablejs" in lowered
        or "enable javascript" in lowered
        or "/sorry/" in lowered
        or "recaptcha" in lowered
    ):
        raise SearxEngineCaptchaException(message="Google CSE returned a blocked or JavaScript-only page")

    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise SearxEngineCaptchaException(message="Google CSE response did not contain results")

    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise SearxEngineCaptchaException(message="Google CSE returned malformed JSONP") from exc

    if not isinstance(data, dict):
        raise SearxEngineAPIException("google cse: response root is not an object")
    return data


def response(resp: "SXNG_Response") -> EngineResults:
    """Convert a Google CSE JSONP response to SearXNG web results."""
    data = _decode_jsonp(resp.text)

    error = data.get("error")
    if error:
        if not isinstance(error, dict):
            raise SearxEngineAPIException(f"google cse: {error}")
        message = error.get("message", "unknown error")
        if str(error.get("code")) == "429":
            raise SearxEngineTooManyRequestsException(message=f"google cse: {message}")
        raise SearxEngineAPIException(f"google cse: {message}")

    if "results" not in data or not isinstance(data["results"], list):
        raise SearxEngineCaptchaException(message="Google CSE response omitted the results list")

    results = EngineResults()
    for item in data["results"]:
        url = item.get("unescapedUrl")
        if not url:
            continue

        result = {
            "url": url,
            "title": item.get("titleNoFormatting", ""),
            "content": item.get("contentNoFormatting", ""),
        }
        thumbnail = item.get("richSnippet", {}).get("cseThumbnail", {}).get("src")
        if thumbnail:
            result["thumbnail"] = thumbnail
        results.add(result)

    return results

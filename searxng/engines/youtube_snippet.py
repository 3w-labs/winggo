# SPDX-License-Identifier: AGPL-3.0-or-later
"""YouTube search that still returns a description snippet, plus a date.

Upstream ``youtube_noapi`` reads the snippet from ``videoRenderer.descriptionSnippet``
only, and YouTube stopped shipping that field in most search responses. Every
result then arrives with an empty ``content``, so the search pipeline is left with
nothing but the title -- which the embedding filter usually scores too low to keep.
Upstream also drops ``publishedTimeText``, the only date the search response
carries, leaving every video undated for a consumer that filters on age.

YouTube still serves the description text under ``detailedMetadataSnippets``, so
upstream's results are taken as-is and both fields are filled in from the same
response. Request building, paging tokens and result ordering stay upstream's, so
this engine only ever adds what was already in the response.
"""

from datetime import datetime
from json import loads

from searx.engines import relative_dates, youtube_noapi
from searx.utils import extr

about = dict(youtube_noapi.about)

categories = list(youtube_noapi.categories)
paging = youtube_noapi.paging
language_support = youtube_noapi.language_support
time_range_support = youtube_noapi.time_range_support

request = youtube_noapi.request

# Upstream writes "-" when a continuation response carries no snippet. That is a
# placeholder, not content, so it counts as missing here.
MISSING_CONTENT = ('', '-', None)


def response(resp):
    results = youtube_noapi.response(resp)
    extras = _extras_by_video_id(resp)
    # One reading of the clock for the whole response, so two videos labelled
    # "3주 전" cannot come out with different dates.
    now = datetime.now()

    for result in results:
        # Paging tokens travel in the same list and carry no URL.
        if not isinstance(result, dict):
            continue

        video_id = _video_id(result.get('url'))
        if not video_id:
            continue

        snippet, label = extras.get(video_id, ('', ''))

        if result.get('content') in MISSING_CONTENT:
            # Empty rather than "-" when nothing was found, so callers can tell a
            # missing snippet from a snippet and fall back to the title themselves.
            result['content'] = snippet

        published = relative_dates.parse_relative_label(label, now)
        if published:
            result['publishedDate'] = published

    return results


def _extras_by_video_id(resp):
    """Snippet text and publication label for every video in the payload."""
    extras = {}

    for video in _video_renderers(_response_json(resp)):
        video_id = video.get('videoId')
        if not video_id:
            continue

        # A video can be rendered more than once in one payload; the first
        # rendering that carries a field wins, so an empty repeat cannot erase it.
        snippet, label = extras.get(video_id, ('', ''))
        extras[video_id] = (
            snippet or _snippet_text(video),
            label or _published_label(video),
        )

    return extras


def _published_label(video):
    """YouTube's reader-facing date, e.g. "3주 전" or "Streamed 6 hours ago".

    Measured across ko/en/ja responses (60 labels): always ``simpleText``, never
    the ``runs`` form the other text fields use.
    """
    return (video.get('publishedTimeText') or {}).get('simpleText', '')


def _response_json(resp):
    """The payload of either response shape.

    A continuation request answers with JSON; the first page embeds the same
    structure in ``ytInitialData``.
    """
    try:
        if resp.search_params.get('engine_data'):
            return loads(resp.text)

        raw = extr(resp.text, 'ytInitialData = ', ';</script>')
        return loads(raw) if raw else {}
    except ValueError:
        return {}


def _video_renderers(node):
    """Every ``videoRenderer`` in the payload, wherever YouTube nested it."""
    if isinstance(node, dict):
        video = node.get('videoRenderer')
        if isinstance(video, dict):
            yield video

        for value in node.values():
            yield from _video_renderers(value)
    elif isinstance(node, list):
        for item in node:
            yield from _video_renderers(item)


def _snippet_text(video):
    text = youtube_noapi.get_text_from_json(video.get('descriptionSnippet') or {})
    if text:
        return text

    # Each entry is one line of the description; the first non-empty one is the
    # summary YouTube itself shows under the title.
    for snippet in video.get('detailedMetadataSnippets') or []:
        if not isinstance(snippet, dict):
            continue

        text = youtube_noapi.get_text_from_json(snippet.get('snippetText') or {})
        if text:
            return text

    return ''


def _video_id(url):
    prefix = youtube_noapi.base_youtube_url

    if not isinstance(url, str) or not url.startswith(prefix):
        return ''

    return url[len(prefix) :]

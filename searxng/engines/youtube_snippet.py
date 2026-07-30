# SPDX-License-Identifier: AGPL-3.0-or-later
"""YouTube search that still returns a description snippet.

Upstream ``youtube_noapi`` reads the snippet from ``videoRenderer.descriptionSnippet``
only, and YouTube stopped shipping that field in most search responses. Every
result then arrives with an empty ``content``, so the search pipeline is left with
nothing but the title -- which the embedding filter usually scores too low to keep.

YouTube still serves the same text under ``detailedMetadataSnippets``, so upstream's
results are taken as-is and the missing snippets are filled in from whichever field
the response happens to carry. Request building, paging tokens and result ordering
stay upstream's, so this engine only ever adds content that was already in the
response.
"""

from json import loads

from searx.engines import youtube_noapi
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
    snippets = _snippets_by_video_id(resp)

    for result in results:
        # Paging tokens travel in the same list and carry no URL.
        if not isinstance(result, dict):
            continue

        video_id = _video_id(result.get('url'))
        if not video_id or result.get('content') not in MISSING_CONTENT:
            continue

        # Empty rather than "-" when nothing was found, so callers can tell a
        # missing snippet from a snippet and fall back to the title themselves.
        result['content'] = snippets.get(video_id, '')

    return results


def _snippets_by_video_id(resp):
    snippets = {}

    for video in _video_renderers(_response_json(resp)):
        video_id = video.get('videoId')
        text = _snippet_text(video)

        if video_id and text:
            snippets[video_id] = text

    return snippets


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

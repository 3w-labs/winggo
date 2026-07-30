# SPDX-License-Identifier: AGPL-3.0-or-later
"""Localised relative publication labels ("3주 전", "3 weeks ago") as datetimes.

Naver and YouTube both date their results with a label meant for readers rather
than a machine-readable timestamp, so both engines need the same parsing.

Only Korean and English are recognised. YouTube's label follows the
``Accept-Language`` header, which SearXNG builds from the caller's locale and
falls back to ``en-US`` when none was requested, so those are the two forms that
actually arrive. Anything else -- a Japanese "3 週間前", a string that merely
contains a number -- yields ``None``: the consumer applies an age cutoff to this
value, so a wrong date does more damage than a missing one.
"""

import calendar
import re
from datetime import timedelta

# A past livestream is labelled with a prefix, but the relative part that
# follows dates the video just the same.
_LIVE_PREFIXES = ("스트리밍 시간:", "Streamed")

_KOREAN = re.compile(r"(\d+)\s*(초|분|시간|일|주|개월|년) 전")
_ENGLISH = re.compile(r"(\d+)\s*(second|minute|hour|day|week|month|year)s? ago", re.IGNORECASE)

_KOREAN_UNITS = {
    "초": "second",
    "분": "minute",
    "시간": "hour",
    "일": "day",
    "주": "week",
    "개월": "month",
    "년": "year",
}

# Units that are a fixed span. Months and years are not, so they shift the
# calendar instead of subtracting a duration.
_DURATIONS = {
    "second": "seconds",
    "minute": "minutes",
    "hour": "hours",
    "day": "days",
    "week": "weeks",
}


def parse_relative_label(value, now):
    """The instant a relative label points at, or None if it is not one.

    ``now`` is required rather than read from the clock so the caller keeps one
    consistent reference for a whole response -- and so tests can pin it.

    The result is approximate by nature: "3개월 전" carries no day of the month,
    let alone a time of day, so precision below the label's own unit is invented
    by this function and should not be relied on.
    """
    value = " ".join((value or "").split())

    for prefix in _LIVE_PREFIXES:
        if value.startswith(prefix):
            value = value[len(prefix) :].strip()
            break

    if value in ("어제", "Yesterday"):
        return now - timedelta(days=1)

    match = _KOREAN.fullmatch(value)
    unit = _KOREAN_UNITS[match.group(2)] if match else None

    if not match:
        match = _ENGLISH.fullmatch(value)
        unit = match.group(2).lower() if match else None

    if not match:
        return None

    amount = int(match.group(1))

    if unit in _DURATIONS:
        return now - timedelta(**{_DURATIONS[unit]: amount})
    if unit == "month":
        return shift_months(now, -amount)
    return shift_years(now, -amount)


def shift_months(value, months):
    """``value`` moved by whole months, clamped to the target month's length."""
    month_index = value.year * 12 + value.month - 1 + months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def shift_years(value, years):
    """``value`` moved by whole years, clamped so Feb 29 survives the move."""
    year = value.year + years
    day = min(value.day, calendar.monthrange(year, value.month)[1])
    return value.replace(year=year, day=day)

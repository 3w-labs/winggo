import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Unlike the engines, this module imports nothing from searx, so it runs on a
// bare python3 with no stubs -- the code under test is the code that ships.
const PYTHON_HARNESS = String.raw`
import importlib.util
import json
import pathlib
import sys
from datetime import datetime

path = pathlib.Path.cwd() / "searxng/engines/relative_dates.py"
spec = importlib.util.spec_from_file_location("relative_dates", path)
relative_dates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relative_dates)

now = datetime.fromisoformat(sys.argv[1])
parsed = {}
for label in sys.argv[2:]:
    value = relative_dates.parse_relative_label(label, now)
    parsed[label] = value.isoformat() if value else None

print(json.dumps(parsed, ensure_ascii=False))
`;

const parse = (now: string, ...labels: string[]): Record<string, string | null> => {
  const run = spawnSync('python3', ['-c', PYTHON_HARNESS, now, ...labels], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

const NOW = '2026-07-30T12:00:00';

// Every Korean label below was observed on a live YouTube or Naver response.
test('Korean relative labels resolve against the given instant', () => {
  assert.deepEqual(
    parse(NOW, '30분 전', '4시간 전', '7일 전', '어제', '2주 전', '3주 전', '5개월 전', '6년 전'),
    {
      '30분 전': '2026-07-30T11:30:00',
      '4시간 전': '2026-07-30T08:00:00',
      '7일 전': '2026-07-23T12:00:00',
      어제: '2026-07-29T12:00:00',
      '2주 전': '2026-07-16T12:00:00',
      '3주 전': '2026-07-09T12:00:00',
      // February is shorter than the 30th, so the day clamps to the 28th.
      '5개월 전': '2026-02-28T12:00:00',
      '6년 전': '2020-07-30T12:00:00',
    },
  );
});

// SearXNG falls back to an en-US Accept-Language when the caller names no
// locale, so English is not a hypothetical -- it is the default.
test('English relative labels resolve the same way', () => {
  assert.deepEqual(
    parse(NOW, '1 day ago', '7 days ago', '3 weeks ago', '1 month ago', '6 years ago', '13 hours ago'),
    {
      '1 day ago': '2026-07-29T12:00:00',
      '7 days ago': '2026-07-23T12:00:00',
      '3 weeks ago': '2026-07-09T12:00:00',
      '1 month ago': '2026-06-30T12:00:00',
      '6 years ago': '2020-07-30T12:00:00',
      '13 hours ago': '2026-07-29T23:00:00',
    },
  );
});

test('a past livestream is dated by the label under its prefix', () => {
  assert.deepEqual(
    parse(NOW, '스트리밍 시간: 10시간 전', '스트리밍 시간: 1일 전', 'Streamed 6 hours ago', 'Streamed 2 days ago'),
    {
      '스트리밍 시간: 10시간 전': '2026-07-30T02:00:00',
      '스트리밍 시간: 1일 전': '2026-07-29T12:00:00',
      'Streamed 6 hours ago': '2026-07-30T06:00:00',
      'Streamed 2 days ago': '2026-07-28T12:00:00',
    },
  );
});

test('anything that is not a whole relative label yields no date', () => {
  assert.deepEqual(
    parse(
      NOW,
      // Japanese is unsupported on purpose: no date beats a wrong one.
      '3 週間前',
      '1 か月前',
      // An absolute date belongs to the engine that knows its format.
      '2024.03.01.',
      // A label that merely contains a relative expression.
      '3주 전에 올라온 영상입니다',
      'posted 3 weeks ago by someone',
      '',
      '150',
      'ago',
      '전',
    ),
    {
      '3 週間前': null,
      '1 か月前': null,
      '2024.03.01.': null,
      '3주 전에 올라온 영상입니다': null,
      'posted 3 weeks ago by someone': null,
      '': null,
      '150': null,
      ago: null,
      전: null,
    },
  );
});

test('month and year shifts clamp to the length of the target month', () => {
  assert.deepEqual(parse('2026-07-31T09:00:00', '1개월 전', '5개월 전'), {
    // June has 30 days, February 28.
    '1개월 전': '2026-06-30T09:00:00',
    '5개월 전': '2026-02-28T09:00:00',
  });
  assert.deepEqual(parse('2024-02-29T09:00:00', '1년 전', '12개월 전'), {
    '1년 전': '2023-02-28T09:00:00',
    '12개월 전': '2023-02-28T09:00:00',
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The engine parses HTML with lxml, which the SearXNG image ships but a bare
// python3 does not. Skipping is deliberate: an earlier version of this test
// stubbed lxml out with a hand-written xpath emulation, and that stub happily
// passed while the engine's selector matched nothing at all on a real SERP.
const lxmlProbe = spawnSync('python3', ['-c', 'import lxml.html'], {
  encoding: 'utf8',
});
const skip =
  lxmlProbe.status === 0
    ? false
    : 'python3 has no lxml — run `pip install lxml` to exercise this engine';

const PYTHON_HARNESS = String.raw`
import importlib.util
import json
import pathlib
import sys
import types
from datetime import datetime

class EngineResults(list):
    def add(self, result):
        self.append(result)

class MainResult:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

def extract_text(nodes):
    if nodes is None:
        return ""
    if not isinstance(nodes, list):
        nodes = [nodes]
    return " ".join(" ".join("".join(node.itertext()).split()) for node in nodes).strip()

searx = types.ModuleType("searx")
result_types = types.ModuleType("searx.result_types")
utils = types.ModuleType("searx.utils")
result_types.EngineResults = EngineResults
result_types.MainResult = MainResult
utils.extract_text = extract_text
sys.modules.update({
    "searx": searx,
    "searx.result_types": result_types,
    "searx.utils": utils,
})

path = pathlib.Path.cwd() / "searxng/engines/korean_site_search.py"
spec = importlib.util.spec_from_file_location("korean_site_search", path)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

# The fixture mixes hosts, so no allow-list and no site: prefix.
engine.allowed_domains = []
engine.site_query = ""

NOW = datetime(2026, 7, 30, 12, 0, 0)

class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW

# Relative labels resolve against the clock, so freeze it for the DOM pass too.
engine.datetime = FrozenDateTime

def isoformat(value):
    return value.isoformat() if value else None

action = sys.argv[1]

if action == "dom":
    fixture = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
    results = engine.response(types.SimpleNamespace(text=fixture))
    print(json.dumps([
        {
            "url": result.url,
            "publishedDate": isoformat(getattr(result, "publishedDate", None)),
        }
        for result in results
    ], ensure_ascii=False))
elif action == "labels":
    print(json.dumps({
        label: isoformat(engine._parse_published_date(label, now=NOW))
        for label in sys.argv[2:]
    }, ensure_ascii=False))
`;

const runEngine = (...args: string[]): unknown => {
  const run = spawnSync('python3', ['-c', PYTHON_HARNESS, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

test(
  'naver web results carry the publication date of the description line',
  { skip },
  () => {
    const results = runEngine(
      'dom',
      'tests/fixtures/korean-site-search-dates.html',
    );

    assert.deepEqual(results, [
      {
        url: 'https://www.clien.net/service/board/kin/19199280',
        publishedDate: '2026-06-01T00:00:00',
      },
      {
        url: 'https://www.clien.net/service/board/lecture/1480181',
        publishedDate: '2011-02-18T00:00:00',
      },
      {
        url: 'https://jinkpark.tistory.com/139',
        publishedDate: '2026-07-27T12:00:00',
      },
      // No label: the snippet's mid-sentence date and the breadcrumb digits
      // must not be promoted to a publication date.
      {
        url: 'https://namu.wiki/w/%EC%86%A1%EA%B0%80%EC%9D%B8',
        publishedDate: null,
      },
    ]);
  },
);

test('only a label that is entirely a date becomes a publication date', { skip }, () => {
  const parsed = runEngine(
    'labels',
    '2024.3.1.',
    '2026. 6. 1.',
    '3일 전',
    '1시간 전',
    '어제',
    '2주 전',
    '5개월 전',
    '3년 전',
    'www.clien.net › kin',
    '2024.03.01. 기준 정보',
    '예산은 150 만원입니다.',
    '2024.13.45.',
  );

  assert.deepEqual(parsed, {
    '2024.3.1.': '2024-03-01T00:00:00',
    // Defensive: every measured label uses the compact form, but a padded one
    // must not be dropped either.
    '2026. 6. 1.': '2026-06-01T00:00:00',
    '3일 전': '2026-07-27T12:00:00',
    '1시간 전': '2026-07-30T11:00:00',
    어제: '2026-07-29T12:00:00',
    '2주 전': '2026-07-16T12:00:00',
    '5개월 전': '2026-02-28T12:00:00',
    '3년 전': '2023-07-30T12:00:00',
    // Not dates: a breadcrumb, a date inside a sentence, plain numbers, and an
    // impossible calendar date.
    'www.clien.net › kin': null,
    '2024.03.01. 기준 정보': null,
    '예산은 150 만원입니다.': null,
    '2024.13.45.': null,
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PYTHON_HARNESS = String.raw`
import importlib.util
import json
import pathlib
import sys
import types

class EngineResults(list):
    def add(self, result):
        self.append(result)

class EngineCache:
    def __init__(self, _name):
        self.values = {}
    def get(self, key):
        return self.values.get(key)
    def set(self, key, value, expire=None):
        self.values[key] = value
        self.expire = expire

class SearxEngineAPIException(Exception):
    pass

class SearxEngineCaptchaException(Exception):
    def __init__(self, suspended_time=None, message="CAPTCHA"):
        super().__init__(message)

class SearxEngineTooManyRequestsException(Exception):
    def __init__(self, suspended_time=None, message="Too many request"):
        super().__init__(message)

searx = types.ModuleType("searx")
engines = types.ModuleType("searx.engines")
enginelib = types.ModuleType("searx.enginelib")
exceptions = types.ModuleType("searx.exceptions")
network = types.ModuleType("searx.network")
result_types = types.ModuleType("searx.result_types")
upstream_google = types.ModuleType("searx.engines.google")

enginelib.EngineCache = EngineCache
exceptions.SearxEngineAPIException = SearxEngineAPIException
exceptions.SearxEngineCaptchaException = SearxEngineCaptchaException
exceptions.SearxEngineTooManyRequestsException = SearxEngineTooManyRequestsException
network.get = lambda *_args, **_kwargs: None
result_types.EngineResults = EngineResults
upstream_google.fetch_traits = lambda *_args, **_kwargs: None
upstream_google.filter_mapping = {0: "off", 1: "medium", 2: "high"}
def get_google_info(_params, engine_traits):
    # Mirror the pinned implementation's requirement that Google traits carry
    # supported_domains. Empty fmkorea traits must not be passed here.
    engine_traits.custom["supported_domains"]
    return {
        "params": {"hl": "en", "lr": "lang_en", "cr": "countryUS"},
        "country": "US",
        "cookies": {"CONSENT": "YES+"},
        "headers": {"Accept": "*/*"},
    }
upstream_google.get_google_info = get_google_info

sys.modules.update({
    "searx": searx,
    "searx.engines": engines,
    "searx.enginelib": enginelib,
    "searx.exceptions": exceptions,
    "searx.network": network,
    "searx.result_types": result_types,
    "searx.engines.google": upstream_google,
})

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

root = pathlib.Path.cwd()
google_cse = load(
    "searx.engines.google_cse",
    root / "searxng/engines/google_cse.py",
)
action = sys.argv[1]

try:
    if action == "attrs":
        # Mirrors is_missing_required_attributes() in searx/engines/__init__.py:
        # a public module attribute left as None makes SearXNG mark the engine
        # inactive at load time.
        output = {
            "google_cse": sorted(
                name
                for name in dir(google_cse)
                if not name.startswith("_") and getattr(google_cse, name) is None
            ),
        }
        fmkorea = load(
            "searx.engines.fmkorea_google",
            root / "searxng/engines/fmkorea_google.py",
        )
        output["fmkorea_google"] = sorted(
            name
            for name in dir(fmkorea)
            if not name.startswith("_") and getattr(fmkorea, name) is None
        )
    elif action == "token":
        text = pathlib.Path(sys.argv[2]).read_text()
        google_cse._CACHE = EngineCache("google")
        google_cse.get = lambda *_args, **_kwargs: types.SimpleNamespace(
            ok=True,
            text=text,
        )
        output = {
            "token": google_cse._cse_token(),
            "expire": google_cse._CACHE.expire,
        }
    elif action == "fmkorea_request":
        google_cse._cse_token = lambda: {
            "cse_tok": "fixture-token",
            "cselibv": "fixture-version",
            "exp": "",
        }
        fmkorea = load(
            "searx.engines.fmkorea_google",
            root / "searxng/engines/fmkorea_google.py",
        )
        params = {
            "pageno": 1,
            "safesearch": 0,
            "time_range": None,
            "headers": {},
        }
        fmkorea.request("openai", params)
        output = {"url": params["url"], "max_page": fmkorea.max_page}
    else:
        text = pathlib.Path(sys.argv[2]).read_text()
        response = types.SimpleNamespace(text=text, status_code=200)
    if action == "google":
        output = list(google_cse.response(response))
    elif action == "fmkorea":
        fmkorea = load(
            "searx.engines.fmkorea_google",
            root / "searxng/engines/fmkorea_google.py",
        )
        output = list(fmkorea.response(response))
    elif action not in ("fmkorea_request", "token", "attrs"):
        raise ValueError(action)
    print(json.dumps({"ok": True, "results": output}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "error": type(exc).__name__,
        "message": str(exc),
    }))
`;

function runEngine(
  action: 'google' | 'fmkorea' | 'fmkorea_request' | 'token' | 'attrs',
  fixture?: string,
): Record<string, unknown> {
  const run = spawnSync(
    'python3',
    ['-c', PYTHON_HARNESS, action, ...(fixture ? [fixture] : [])],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('google CSE response extracts title, URL, and content', () => {
  const output = runEngine(
    'google',
    'tests/fixtures/google-cse-results.jsonp',
  );

  assert.equal(output.ok, true);
  assert.deepEqual(output.results, [
    {
      url: 'https://openai.com/',
      title: 'OpenAI',
      content: 'Research and deployment company.',
      thumbnail: 'https://openai.com/thumbnail.png',
    },
    {
      url: 'https://www.fmkorea.com/123456789',
      title: 'OpenAI 이야기 - 에펨코리아',
      content: '에펨코리아에 올라온 OpenAI 관련 글입니다.',
    },
  ]);
});

test('google JavaScript stub is reported as a blocked engine', () => {
  const output = runEngine(
    'google',
    'tests/fixtures/google-js-stub.html',
  );

  assert.equal(output.ok, false);
  assert.equal(output.error, 'SearxEngineCaptchaException');
});

test('fmkorea reuses the CSE parser and keeps only FMKorea URLs', () => {
  const output = runEngine(
    'fmkorea',
    'tests/fixtures/google-cse-results.jsonp',
  );

  assert.equal(output.ok, true);
  assert.deepEqual(output.results, [
    {
      url: 'https://www.fmkorea.com/123456789',
      title: 'OpenAI 이야기 - 에펨코리아',
      content: '에펨코리아에 올라온 OpenAI 관련 글입니다.',
    },
  ]);
});

test('fmkorea sends a site-restricted query through the CSE request builder', () => {
  const output = runEngine(
    'fmkorea_request',
    'tests/fixtures/google-cse-results.jsonp',
  );

  assert.equal(output.ok, true);
  const url = new URL((output.results as { url: string }).url);
  assert.equal(url.origin + url.pathname, 'https://cse.google.com/cse/element/v1');
  assert.equal(url.searchParams.get('q'), 'site:fmkorea.com openai');
  assert.equal(url.searchParams.get('hl'), 'ko');
  assert.equal(url.searchParams.get('lr'), 'lang_ko');
  assert.equal(url.searchParams.get('gl'), 'KR');
  assert.equal((output.results as { max_page: number }).max_page, 5);
});

test('google CSE token response is parsed and cached for one hour', () => {
  const output = runEngine('token', 'tests/fixtures/google-cse-token.js');

  assert.equal(output.ok, true);
  assert.deepEqual(output.results, {
    token: {
      cse_tok: 'fixture-cse-token',
      cselibv: 'fixture-cselib-version',
      exp: 'experiment-a,experiment-b',
    },
    expire: 3600,
  });
});

test('overlay engines expose no public attribute that SearXNG rejects as None', () => {
  // searx/engines/__init__.py sets an engine inactive when any public module
  // attribute is None at load time.  A `CACHE = None` module global silently
  // disabled the whole google engine, so guard both overlays against it.
  const output = runEngine('attrs');

  assert.equal(output.ok, true);
  const results = output.results as Record<string, string[]>;
  assert.deepEqual(results.google_cse, []);
  assert.deepEqual(results.fmkorea_google, []);
});

test('Docker and settings expose the CSE overlay as google', async () => {
  const [dockerfile, settings] = await Promise.all([
    readFile('Dockerfile', 'utf8'),
    readFile('searxng/settings.yml', 'utf8'),
  ]);

  assert.match(
    dockerfile,
    /COPY searxng\/engines\/google_cse\.py .*\/searx\/engines\/google_cse\.py/,
  );
  assert.match(
    settings,
    /- name: google\s+engine: google_cse\s+shortcut: go\s+categories: \[general, web\]\s+disabled: false/,
  );
});

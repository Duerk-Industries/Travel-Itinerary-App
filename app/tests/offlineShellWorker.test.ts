/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import vm from 'vm';

// Minimal Response/Cache/CacheStorage doubles: enough for the worker's logic, no browser needed.
class FakeResponse {
  constructor(
    public body: string,
    public init: { status?: number; redirected?: boolean } = {},
  ) {}
  get status() { return this.init.status ?? 200; }
  get ok() { return this.status >= 200 && this.status < 300; }
  get redirected() { return Boolean(this.init.redirected); }
  clone() { return new FakeResponse(this.body, this.init); }
  async text() { return this.body; }
  static error() { return new FakeResponse('', { status: 0 }); }
}

const ORIGIN = 'https://app.example';
const keyOf = (request: unknown): string => {
  const url = typeof request === 'string' ? request : (request as { url: string }).url;
  const parsed = new URL(url, ORIGIN);
  return parsed.pathname + parsed.search;
};

class FakeCache {
  entries = new Map<string, FakeResponse>();
  async match(request: unknown) { return this.entries.get(keyOf(request)); }
  async put(request: unknown, response: FakeResponse) { this.entries.set(keyOf(request), response); }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(request: unknown) { return this.entries.delete(keyOf(request)); }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name: string) { return this.stores.delete(name); }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const loadWorkerModule = () => {
  const sandbox: Record<string, unknown> = { module: { exports: {} }, URL, Response: FakeResponse, setTimeout, clearTimeout, Promise };
  vm.runInNewContext(source, sandbox);
  return (sandbox.module as { exports: any }).exports;
};
const sw = loadWorkerModule();

const INDEX_HTML = `<html><head><link href="/_expo/static/css/app-abc.css" rel="stylesheet"></head>
<body><script src="/_expo/static/js/web/index-123.js" defer></script><img src="/assets/logo.png"></body></html>`;

const request = (url: string, opts: { method?: string; mode?: string; headers?: Record<string, string> } = {}) => ({
  url: new URL(url, ORIGIN).href,
  method: opts.method ?? 'GET',
  mode: opts.mode ?? 'no-cors',
  headers: { has: (name: string) => Object.keys(opts.headers ?? {}).some((h) => h.toLowerCase() === name.toLowerCase()) },
});

const fetchEvent = (req: ReturnType<typeof request>) => {
  let responded: Promise<FakeResponse> | null = null;
  return {
    request: req,
    respondWith: (value: Promise<FakeResponse>) => { responded = value; },
    get response() { return responded; },
  };
};

const setup = (handler: (url: string, init?: unknown) => Promise<FakeResponse>, opts: { setTimeoutFn?: any } = {}) => {
  const caches = new FakeCacheStorage();
  const fetchFn = jest.fn(handler);
  const worker = sw.createWorker({ caches, fetchFn, selfOrigin: ORIGIN, setTimeoutFn: opts.setTimeoutFn ?? setTimeout, clearTimeoutFn: clearTimeout });
  const shell = () => caches.open(sw.SHELL_CACHE);
  const assets = () => caches.open(sw.ASSET_CACHE);
  return { caches, fetchFn, worker, shell, assets };
};

const run = async (promise: Promise<FakeResponse> | null): Promise<FakeResponse | undefined> => (promise ? promise : undefined);

describe('classifyRequest', () => {
  const classify = (over: Record<string, unknown>) =>
    sw.classifyRequest({ url: new URL('/', ORIGIN), method: 'GET', mode: 'navigate', hasAuthorization: false, hasRange: false, selfOrigin: ORIGIN, ...over });

  it('treats single-page-app navigations as the shell', () => {
    expect(classify({ url: new URL('/', ORIGIN) })).toBe('shell');
    expect(classify({ url: new URL('/app/trips/123', ORIGIN) })).toBe('shell');
    expect(classify({ url: new URL('/index.html', ORIGIN) })).toBe('shell');
  });

  it('leaves static pages such as the legal documents to the network', () => {
    expect(classify({ url: new URL('/privacy.html', ORIGIN) })).toBe('network');
  });

  it('caches only content-hashed build files and assets', () => {
    expect(classify({ mode: 'no-cors', url: new URL('/_expo/static/js/web/index-123.js', ORIGIN) })).toBe('asset');
    expect(classify({ mode: 'no-cors', url: new URL('/assets/logo.png', ORIGIN) })).toBe('asset');
    expect(classify({ mode: 'no-cors', url: new URL('/favicon.ico', ORIGIN) })).toBe('network');
  });

  it.each(['/api/trips', '/api/expenses?tripId=1', '/socket.io/?EIO=4', '/public/blog/u/t', '/__/auth/handler'])(
    'never touches private or dynamic path %s',
    (pathname) => {
      expect(classify({ mode: 'navigate', url: new URL(pathname, ORIGIN) })).toBe('network');
      expect(classify({ mode: 'cors', url: new URL(pathname, ORIGIN) })).toBe('network');
    },
  );

  it('ignores other origins, non-GET requests, authorized requests, range requests and the worker itself', () => {
    expect(classify({ url: new URL('https://maps.example/_expo/static/x.js') })).toBe('network');
    expect(classify({ method: 'POST', url: new URL('/_expo/static/x.js', ORIGIN), mode: 'no-cors' })).toBe('network');
    expect(classify({ hasAuthorization: true, url: new URL('/_expo/static/x.js', ORIGIN), mode: 'no-cors' })).toBe('network');
    expect(classify({ hasRange: true, url: new URL('/assets/video.mp4', ORIGIN), mode: 'no-cors' })).toBe('network');
    expect(classify({ url: new URL('/sw.js', ORIGIN), mode: 'no-cors' })).toBe('network');
  });
});

describe('install', () => {
  it('stores the shell and every hashed file it references', async () => {
    const { worker, fetchFn, shell, assets } = setup(async (url) => (url === '/index.html' ? new FakeResponse(INDEX_HTML) : new FakeResponse(`file:${url}`)));
    let work: Promise<unknown> | undefined;
    worker.onInstall({ waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
    expect((await (await shell()).match('/index.html'))?.body).toBe(INDEX_HTML);
    const cachedAssets = await (await assets()).keys();
    expect(cachedAssets.map((k: { url: string }) => k.url).sort()).toEqual(['/_expo/static/css/app-abc.css', '/_expo/static/js/web/index-123.js', '/assets/logo.png']);
    // The shell is fetched past the HTTP cache so a stale copy is never stored.
    expect(fetchFn.mock.calls[0]).toEqual(['/index.html', { cache: 'reload' }]);
  });

  it('still installs when the network is down or a file fails', async () => {
    const offline = setup(async () => { throw new TypeError('offline'); });
    let work: Promise<unknown> | undefined;
    offline.worker.onInstall({ waitUntil: (p: Promise<unknown>) => { work = p; } });
    await expect(work).resolves.toBeUndefined();

    const partial = setup(async (url) => {
      if (url === '/index.html') return new FakeResponse(INDEX_HTML);
      if (url.includes('css')) throw new TypeError('flaky');
      return new FakeResponse('ok');
    });
    partial.worker.onInstall({ waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
    expect((await (await partial.assets()).keys()).length).toBe(0);
    expect(await (await partial.shell()).match('/index.html')).toBeUndefined();
  });

  it('does not store an error page as the shell', async () => {
    const { worker, shell } = setup(async () => new FakeResponse('Bad gateway', { status: 502 }));
    let work: Promise<unknown> | undefined;
    worker.onInstall({ waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
    expect(await (await shell()).match('/index.html')).toBeUndefined();
  });
});

describe('fetch: leaves private traffic alone', () => {
  it.each([
    request('/api/trips', { mode: 'cors' }),
    request('/api/expenses', { method: 'POST', mode: 'cors' }),
    request('/_expo/static/js/x.js', { headers: { Authorization: 'Bearer t' } }),
    request('https://other.example/_expo/static/js/x.js'),
  ])('does not intercept %p', async (req) => {
    const { worker, fetchFn } = setup(async () => new FakeResponse('x'));
    const event = fetchEvent(req);
    worker.onFetch(event);
    expect(event.response).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('fetch: hashed assets are cache-first', () => {
  it('fetches once, then serves from cache without touching the network', async () => {
    const { worker, fetchFn } = setup(async () => new FakeResponse('bundle'));
    const first = fetchEvent(request('/_expo/static/js/web/index-1.js'));
    worker.onFetch(first);
    expect((await run(first.response))?.body).toBe('bundle');
    const second = fetchEvent(request('/_expo/static/js/web/index-1.js'));
    worker.onFetch(second);
    expect((await run(second.response))?.body).toBe('bundle');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never caches failures or redirects', async () => {
    let status = 500;
    const { worker, fetchFn } = setup(async () => new FakeResponse('nope', { status }));
    const a = fetchEvent(request('/assets/a.png'));
    worker.onFetch(a);
    await run(a.response);
    status = 200;
    const b = fetchEvent(request('/assets/a.png'));
    worker.onFetch(b);
    await run(b.response);
    expect(fetchFn).toHaveBeenCalledTimes(2); // the 500 was not stored

    const redirecting = setup(async () => new FakeResponse('moved', { redirected: true }));
    for (let i = 0; i < 2; i += 1) {
      const e = fetchEvent(request('/assets/r.png'));
      redirecting.worker.onFetch(e);
      await run(e.response);
    }
    expect(redirecting.fetchFn).toHaveBeenCalledTimes(2);
  });

  it(`keeps at most ${150} stored files, dropping the oldest`, async () => {
    const { worker, assets } = setup(async (url) => new FakeResponse(`file:${url}`));
    for (let i = 0; i < sw.MAX_ASSET_ENTRIES + 5; i += 1) {
      const e = fetchEvent(request(`/assets/file-${i}.png`));
      worker.onFetch(e);
      await run(e.response);
    }
    const keys = (await (await assets()).keys()).map((k: { url: string }) => k.url);
    expect(keys).toHaveLength(sw.MAX_ASSET_ENTRIES);
    expect(keys).not.toContain('/assets/file-0.png');
    expect(keys).toContain(`/assets/file-${sw.MAX_ASSET_ENTRIES + 4}.png`);
  });
});

describe('fetch: the app shell is network-first with an offline fallback', () => {
  const navigate = (url = '/') => fetchEvent(request(url, { mode: 'navigate' }));

  it('serves the live page when online and refreshes the stored shell', async () => {
    const { worker, shell } = setup(async () => new FakeResponse('NEW SHELL'));
    const event = navigate('/app/trips');
    worker.onFetch(event);
    expect((await run(event.response))?.body).toBe('NEW SHELL');
    expect((await (await shell()).match('/index.html'))?.body).toBe('NEW SHELL');
  });

  it('falls back to the last good shell when offline, for any app route', async () => {
    let online = true;
    const { worker } = setup(async () => {
      if (!online) throw new TypeError('offline');
      return new FakeResponse('LAST GOOD');
    });
    const warm = navigate('/');
    worker.onFetch(warm);
    await run(warm.response);

    online = false;
    const offline = navigate('/app/trips/42');
    worker.onFetch(offline);
    expect((await run(offline.response))?.body).toBe('LAST GOOD');
  });

  it('falls back to the stored shell when the server is erroring, and never stores the error', async () => {
    let status = 200;
    const { worker, shell } = setup(async () => new FakeResponse(status === 200 ? 'GOOD' : 'Bad gateway', { status }));
    const warm = navigate();
    worker.onFetch(warm);
    await run(warm.response);
    status = 502;
    const failing = navigate();
    worker.onFetch(failing);
    expect((await run(failing.response))?.body).toBe('GOOD');
    expect((await (await shell()).match('/index.html'))?.body).toBe('GOOD');
  });

  it('does not store a redirected response (for example a login bounce) as the shell', async () => {
    const { worker, shell } = setup(async () => new FakeResponse('redirected page', { redirected: true }));
    const event = navigate();
    worker.onFetch(event);
    await run(event.response);
    expect(await (await shell()).match('/index.html')).toBeUndefined();
  });

  it('uses the stored shell when the network is too slow, instead of waiting', async () => {
    let releaseNetwork: (r: FakeResponse) => void = () => undefined;
    const slow = new Promise<FakeResponse>((resolve) => { releaseNetwork = resolve; });
    let call = 0;
    const timers: Array<() => void> = [];
    const { worker, shell } = setup(
      async () => (call++ === 0 ? new FakeResponse('OLD') : slow),
      { setTimeoutFn: (fn: () => void) => { timers.push(fn); return 1; } },
    );
    await (await shell()).put('/index.html', new FakeResponse('OLD'));
    const event = navigate();
    worker.onFetch(event);
    await new Promise((resolve) => setImmediate(resolve)); // let the worker open its cache and arm the timer
    timers[0]!(); // the 4s timeout fires
    expect((await run(event.response))?.body).toBe('OLD');
    releaseNetwork(new FakeResponse('LATE'));
  });

  it('waits for a slow network on the very first visit rather than failing a working load', async () => {
    let releaseNetwork: (r: FakeResponse) => void = () => undefined;
    const slow = new Promise<FakeResponse>((resolve) => { releaseNetwork = resolve; });
    const timers: Array<() => void> = [];
    const { worker } = setup(async () => slow, { setTimeoutFn: (fn: () => void) => { timers.push(fn); return 1; } });
    const event = navigate();
    worker.onFetch(event);
    await new Promise((resolve) => setImmediate(resolve)); // let the worker open its cache and arm the timer
    timers[0]!();
    releaseNetwork(new FakeResponse('FIRST VISIT'));
    expect((await run(event.response))?.body).toBe('FIRST VISIT');
  });

  it('fails cleanly, not with a hang, when offline with nothing stored', async () => {
    const { worker } = setup(async () => { throw new TypeError('offline'); });
    const event = navigate();
    worker.onFetch(event);
    expect((await run(event.response))?.status).toBe(0);
  });

  it('does not take over static pages such as /privacy.html', async () => {
    const { worker, fetchFn } = setup(async () => new FakeResponse('x'));
    const event = navigate('/privacy.html');
    worker.onFetch(event);
    expect(event.response).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('removes old worker caches only, leaves unrelated caches alone, and takes control', async () => {
    const caches = new FakeCacheStorage();
    await caches.open('wb-shell-v0');
    await caches.open('wb-assets-v0');
    await caches.open(sw.SHELL_CACHE);
    await caches.open('some-other-app-cache');
    const claim = jest.fn(async () => undefined);
    const worker = sw.createWorker({ caches, fetchFn: jest.fn(), selfOrigin: ORIGIN, claimClients: claim });
    let work: Promise<unknown> | undefined;
    worker.onActivate({ waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
    expect((await caches.keys()).sort()).toEqual(['some-other-app-cache', sw.SHELL_CACHE].sort());
    expect(claim).toHaveBeenCalledTimes(1);
  });
});


describe('atomic offline build updates', () => {
  it('keeps the previous shell when a new hashed boot chunk is unavailable', async () => {
    const nextHtml = '<html><script src="/_expo/static/js/web/new-build.js"></script></html>';
    const { worker, shell } = setup(async url => keyOf(url).includes('new-build.js')
      ? new FakeResponse('missing', { status: 404 }) : new FakeResponse(nextHtml));
    await (await shell()).put('/index.html', new FakeResponse('LAST COMPLETE BUILD'));
    const event = fetchEvent(request('/', { mode: 'navigate' }));
    worker.onFetch(event);
    expect((await run(event.response))?.body).toBe(nextHtml);
    expect((await (await shell()).match('/index.html'))?.body).toBe('LAST COMPLETE BUILD');
  });
});


it('never evicts the current shell boot chunk while trimming optional cached assets', async () => {
  const { worker, shell, assets } = setup(async () => new FakeResponse('asset'));
  await (await shell()).put('/index.html', new FakeResponse('<script src="/_expo/static/js/web/boot.js"></script>'));
  await (await assets()).put('/_expo/static/js/web/boot.js', new FakeResponse('boot'));
  for (let i = 0; i < sw.MAX_ASSET_ENTRIES; i += 1) {
    const event = fetchEvent(request(`/assets/optional-${i}.png`)); worker.onFetch(event); await run(event.response);
  }
  expect((await (await assets()).keys())).toHaveLength(sw.MAX_ASSET_ENTRIES);
  expect((await (await assets()).match('/_expo/static/js/web/boot.js'))?.body).toBe('boot');
});

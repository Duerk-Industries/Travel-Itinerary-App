/*
 * WanderBunnies offline-shell service worker (web only).
 *
 * What it does: lets the web app open without a connection by keeping the app shell (index.html) and the
 * hashed build files it loads. Nothing else.
 *
 * What it deliberately does NOT do:
 *   - Cache anything from /api, /socket.io, public blog endpoints, Firebase's /__/ auth helpers, other
 *     origins, non-GET requests, range requests, or any request that carries an Authorization header.
 *     Trip data and sessions never enter these caches.
 *   - Cache the worker script itself.
 *   - Serve a stale app after a deploy: navigations are network-first, so an online user always gets the
 *     newest index.html (which points at the newest hashed files). The cache is only the offline fallback.
 *
 * Rollback: replace this file with one that calls self.registration.unregister() (and deletes the "wb-"
 * caches), or build with EXPO_PUBLIC_DISABLE_OFFLINE_SHELL=1 so the app unregisters it on next load.
 * Bump VERSION only when the strategy itself changes; hashed asset names already change per build.
 */
'use strict';

const VERSION = 'v1';
const SHELL_CACHE = `wb-shell-${VERSION}`;
const ASSET_CACHE = `wb-assets-${VERSION}`;
const SHELL_URL = '/index.html';
const NAVIGATION_TIMEOUT_MS = 4000;
const MAX_ASSET_ENTRIES = 150;
const NEVER_CACHE_PREFIXES = ['/api/', '/socket.io/', '/public/blog/', '/__/'];
const ASSET_PREFIXES = ['/_expo/static/', '/assets/'];
const ASSET_URL_PATTERN = /\/(?:_expo\/static|assets)\/[^"'<>\s)\\]+/g;

/**
 * Decides how one request is handled: 'network' (leave it alone), 'shell' (network-first with the cached
 * shell as the offline fallback) or 'asset' (cache-first, files are content-hashed).
 */
function classifyRequest({ url, method, mode, hasAuthorization, hasRange, selfOrigin }) {
  if (method !== 'GET') return 'network';
  if (url.origin !== selfOrigin) return 'network';
  if (hasAuthorization || hasRange) return 'network';
  const path = url.pathname;
  if (path === '/sw.js') return 'network';
  if (NEVER_CACHE_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'network';
  if (mode === 'navigate') {
    const last = path.split('/').pop() || '';
    const hasExtension = last.includes('.');
    // "/", "/app/trips" and "/index.html" are the single-page app. Static pages such as /privacy.html are not.
    return !hasExtension || path === SHELL_URL ? 'shell' : 'network';
  }
  if (ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'asset';
  return 'network';
}

function createWorker({ caches, fetchFn, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, selfOrigin, skipWaiting = () => undefined, claimClients = () => Promise.resolve() }) {
  const cacheable = (response) => Boolean(response) && response.ok && response.status === 200 && !response.redirected;

  async function trim(cache) {
    const keys = await cache.keys();
    const overflow = keys.length - MAX_ASSET_ENTRIES;
    for (let i = 0; i < overflow; i += 1) await cache.delete(keys[i]);
  }

  async function precache() {
    try {
      const response = await fetchFn(SHELL_URL, { cache: 'reload' });
      if (!cacheable(response)) return;
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(SHELL_URL, response.clone());
      const html = await response.text();
      const assets = await caches.open(ASSET_CACHE);
      const urls = Array.from(new Set(html.match(ASSET_URL_PATTERN) || []));
      await Promise.all(urls.map(async (assetUrl) => {
        try {
          const assetResponse = await fetchFn(assetUrl);
          if (cacheable(assetResponse)) await assets.put(assetUrl, assetResponse);
        } catch {
          // A file that can't be fetched now is simply cached the first time it is used.
        }
      }));
      await trim(assets);
    } catch {
      // Installing must never fail just because the user is offline or the network is flaky.
    }
  }

  async function cacheFirst(request) {
    const cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetchFn(request);
    if (cacheable(response)) {
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  }

  async function networkFirstShell(request) {
    const shell = await caches.open(SHELL_CACHE);
    let timer;
    const network = fetchFn(request).then(
      (response) => ({ response }),
      () => ({ response: null }),
    );
    const timeout = new Promise((resolve) => {
      timer = setTimeoutFn(() => resolve({ response: null, timedOut: true }), NAVIGATION_TIMEOUT_MS);
    });
    const first = await Promise.race([network, timeout]);
    clearTimeoutFn(timer);

    if (first.response && cacheable(first.response)) {
      await shell.put(SHELL_URL, first.response.clone());
      return first.response;
    }
    // Offline, slow, or the server is erroring: fall back to the last good shell if there is one.
    const cached = await shell.match(SHELL_URL);
    if (cached) return cached;
    // Nothing cached (first ever visit): wait for the network rather than failing a slow-but-working load.
    const late = first.timedOut ? (await network).response : first.response;
    return late || Response.error();
  }

  function onInstall(event) {
    skipWaiting();
    event.waitUntil(precache());
  }

  function onActivate(event) {
    event.waitUntil((async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('wb-') && !keep.has(name)).map((name) => caches.delete(name)));
      await claimClients();
    })());
  }

  function onFetch(event) {
    const { request } = event;
    const strategy = classifyRequest({
      url: new URL(request.url),
      method: request.method,
      mode: request.mode,
      hasAuthorization: request.headers.has('Authorization'),
      hasRange: request.headers.has('Range'),
      selfOrigin,
    });
    if (strategy === 'asset') event.respondWith(cacheFirst(request));
    else if (strategy === 'shell') event.respondWith(networkFirstShell(request));
  }

  return { onInstall, onActivate, onFetch };
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  const worker = createWorker({
    caches: self.caches,
    fetchFn: (...args) => self.fetch(...args),
    selfOrigin: self.location.origin,
    skipWaiting: () => self.skipWaiting(),
    claimClients: () => self.clients.claim(),
  });
  self.addEventListener('install', worker.onInstall);
  self.addEventListener('activate', worker.onActivate);
  self.addEventListener('fetch', worker.onFetch);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyRequest, createWorker, SHELL_CACHE, ASSET_CACHE, SHELL_URL, MAX_ASSET_ENTRIES, NAVIGATION_TIMEOUT_MS };
}

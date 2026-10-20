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
    let overflow = keys.length - MAX_ASSET_ENTRIES;
    if (overflow <= 0) return;
    const shell = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
    const pinned = new Set(shell ? (await shell.text()).match(ASSET_URL_PATTERN) || [] : []);
    for (const key of keys) {
      if (overflow <= 0) break;
      if (pinned.has(new URL(key.url, selfOrigin).pathname)) continue;
      await cache.delete(key);
      overflow -= 1;
    }
  }

  // Commit the entry document only after its boot assets are durably cached.
  // A partial deploy/download must not replace a still-readable offline build.
  async function saveCompleteShell(response) {
    const html = await response.clone().text();
    const urls = Array.from(new Set(html.match(ASSET_URL_PATTERN) || []));
    if (urls.length > 32 || html.length > 1024 * 1024) return false;
    const assets = await caches.open(ASSET_CACHE);
    try {
      const staged = [];
      for (const url of urls) {
        if (await assets.match(url)) continue;
        const asset = await fetchFn(url);
        if (!cacheable(asset)) return false;
        staged.push([url, asset]);
      }
      for (const [url, asset] of staged) await assets.put(url, asset);
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(SHELL_URL, response.clone());
      await trim(assets);
      return true;
    } catch { return false; }
  }

  async function precache() {
    try {
      const response = await fetchFn(SHELL_URL, { cache: 'reload' });
      if (cacheable(response)) await saveCompleteShell(response);
    } catch {
      // Offline installation retains the previous complete build.
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

  async function networkFirstShell(request, keepAlive) {
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
      const save = saveCompleteShell(first.response);
      if (keepAlive) keepAlive(save);
      else await save;
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
    else if (strategy === 'shell') event.respondWith(networkFirstShell(request,
      typeof event.waitUntil === 'function' ? (work) => event.waitUntil(work) : undefined));
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

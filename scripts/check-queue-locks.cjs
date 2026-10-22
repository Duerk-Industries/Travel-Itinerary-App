// Real two-tab check of the expense-queue locks (gap-closing plan §5.3).
//   node scripts/check-queue-locks.cjs
// Bundles the IndexedDB lease (app/utils/pendingWriteStore.web.ts) and the localStorage fallback lock
// (app/utils/replayLock.ts) and races them between two tabs of one headless Chromium on a shared
// origin. Set PLAYWRIGHT_CHROMIUM to a browser executable if the one Playwright expects is missing.
const path = require('path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const KEY = 'stp.pending-expenses.v1.locks.owner';

(async () => {
  const bundle = await esbuild.build({
    stdin: {
      contents: "import { transactionalPendingWriteStore as store } from './app/utils/pendingWriteStore.web'; import { withStorageLease } from './app/utils/replayLock'; window.store = store; window.withStorageLease = withStorageLease;",
      resolveDir: root, loader: 'ts',
    },
    bundle: true, format: 'iife', platform: 'browser', write: false,
  });
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const context = await browser.newContext();
  const open = async () => {
    const page = await context.newPage();
    await page.route('http://locks.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>tab</title>' }));
    await page.goto('http://locks.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return page;
  };
  const [a, b] = [await open(), await open()];
  const result = {};

  // 1. IndexedDB lease: one owner at a time across tabs, handed over on release.
  await a.evaluate(k => window.store.read(k), KEY);
  result.idbFirstClaim = await a.evaluate(k => window.store.claim(k, 'tab-a', 30000), KEY);
  result.idbSecondClaimRefused = !(await b.evaluate(k => window.store.claim(k, 'tab-b', 30000), KEY));
  result.idbWriteWithoutLeaseRefused = await b.evaluate(async k => {
    try { await window.store.update(k, entries => entries, 'tab-b'); return false; } catch { return true; }
  }, KEY);
  await a.evaluate(k => window.store.release(k, 'tab-a'), KEY);
  result.idbHandOver = await b.evaluate(k => window.store.claim(k, 'tab-b', 30000), KEY);
  await b.evaluate(k => window.store.release(k, 'tab-b'), KEY);

  // 2. A lease left by a clock that later moved back must not block replay.
  await a.evaluate(async k => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('wanderbunnies-pending-writes-v1', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('queues', 'readwrite');
        const store = tx.objectStore('queues');
        const get = store.get(k);
        get.onsuccess = () => { store.put({ ...(get.result || { raw: '[]', retired: {} }), lease: { token: 'future-owner', until: Date.now() + 3 * 3600_000 } }, k); };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      };
    });
  }, KEY);
  result.idbFutureLeaseDoesNotBlock = await b.evaluate(k => window.store.claim(k, 'tab-b', 30000), KEY);
  await b.evaluate(k => window.store.release(k, 'tab-b'), KEY);

  // 3. localStorage fallback lock: many simultaneous attempts from two tabs; count double runs.
  const ROUNDS = 40;
  let doubleRuns = 0, noRuns = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const name = `race-${round}`;
    const attempt = page => page.evaluate(async n => {
      const ran = await window.withStorageLease(n, async () => { await new Promise(r => setTimeout(r, 150)); return 1; });
      return ran === 1;
    }, name);
    const [ra, rb] = await Promise.all([attempt(a), attempt(b)]);
    if (ra && rb) doubleRuns += 1;
    if (!ra && !rb) noRuns += 1;
  }
  result.fallbackRounds = ROUNDS; result.fallbackDoubleRuns = doubleRuns; result.fallbackNoRuns = noRuns;

  // 4. The fallback lock is released afterwards and a crashed holder's lease expires.
  result.fallbackReleased = await a.evaluate(() => localStorage.getItem('stp.replay-lock.race-0') === null);
  await a.evaluate(() => localStorage.setItem('stp.replay-lock.dead', JSON.stringify({ token: 'crashed', until: Date.now() - 1 })));
  result.fallbackTakesOverExpired = await b.evaluate(async () => (await window.withStorageLease('dead', async () => 'ok')) === 'ok');

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  const failures = [];
  for (const k of ['idbFirstClaim', 'idbSecondClaimRefused', 'idbWriteWithoutLeaseRefused', 'idbHandOver', 'idbFutureLeaseDoesNotBlock', 'fallbackReleased', 'fallbackTakesOverExpired']) if (result[k] !== true) failures.push(k);
  if (result.fallbackNoRuns !== 0) failures.push('fallbackNoRuns (a round where nobody ran)');
  if (failures.length) { console.error('FAILED: ' + failures.join(', ')); process.exit(1); }
  console.log(`OK: IndexedDB lease is exclusive across tabs; fallback lock double-ran ${doubleRuns} of ${ROUNDS} simultaneous races (localStorage has no compare-and-swap, so a rare double run is possible; replays are idempotent).`);
})().catch(error => { console.error(error); process.exit(1); });

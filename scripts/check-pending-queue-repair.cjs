// Real-browser check of the expense-queue repair against the actual IndexedDB adapter.
//   node scripts/check-pending-queue-repair.cjs
// Bundles app/utils/pendingWriteStore.web.ts with esbuild and runs it in headless Chromium on a
// synthetic origin (no app server needed). Set PLAYWRIGHT_CHROMIUM to a browser executable if the
// one Playwright expects is not installed. Exits non-zero if any expectation fails.
const path = require('path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const expected = {
  readThrows: true, abortedRepair: true, originalAfterAbort: '{broken-transactional',
  counts: { written: 2, alreadyHandled: 1 }, readAfter: ['a:key-a', 'b:key-b'],
  idbBackup: '{broken-transactional', legacyBackup: '{broken-legacy', legacyCleared: true,
  retiredKept: ['done'], legacyKept: true, mergedWithLegacy: ['legacy-ok', 'x'], noBackupInLocalStorage: true,
};

(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: "import { transactionalPendingWriteStore as store } from './app/utils/pendingWriteStore.web'; window.store = store;", resolveDir: root, loader: 'ts' },
    bundle: true, format: 'iife', platform: 'browser', write: false,
  });
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.route('http://repair.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
  await page.goto('http://repair.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const store = window.store; const K = 'stp.pending-expenses.v1.test.owner';
    const entry = (id) => ({ id, kind: 'createExpense', args: { operationKey: 'key-' + id }, enqueuedAtMs: 1, attempts: 0 });
    const idb = () => new Promise((res, rej) => { const r = indexedDB.open('wanderbunnies-pending-writes-v1', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const getRow = async (key) => { const db = await idb(); return new Promise((res) => { const q = db.transaction('queues').objectStore('queues').get(key); q.onsuccess = () => res(q.result); }); };
    const putRow = async (key, row) => { const db = await idb(); return new Promise((res) => { const tx = db.transaction('queues', 'readwrite'); tx.objectStore('queues').put(row, key); tx.oncomplete = res; }); };
    const out = {};
    await store.read('warmup').catch(() => {}); // creates the database
    await putRow(K, { raw: '{broken-transactional', retired: { done: 1 } });
    localStorage.setItem(K, '{broken-legacy');
    out.readThrows = await store.read(K).then(() => false, () => true);

    // Atomicity: an interrupted repair leaves the original untouched.
    const originalPut = IDBObjectStore.prototype.put; let aborted = false;
    try { IDBObjectStore.prototype.put = function (...a) { const r = originalPut.apply(this, a); this.transaction.abort(); return r; }; await store.repair(K, [entry('a')]); } catch { aborted = true; } finally { IDBObjectStore.prototype.put = originalPut; }
    out.abortedRepair = aborted;
    out.originalAfterAbort = (await getRow(K)).raw;

    const res = await store.repair(K, [entry('a'), entry('b'), entry('done')]);
    out.counts = { written: res.written, alreadyHandled: res.alreadyHandled };
    out.readAfter = (await store.read(K)).map(e => e.id + ':' + e.args.operationKey);
    out.idbBackup = (await getRow(res.backupKey)).raw;
    out.legacyBackup = localStorage.getItem(res.backupKey);
    out.legacyCleared = localStorage.getItem(K) === null;
    out.retiredKept = Object.keys((await getRow(K)).retired);

    // A readable legacy copy is left in place.
    const K2 = 'stp.pending-expenses.v1.test.second';
    await putRow(K2, { raw: '{broken', retired: {} });
    localStorage.setItem(K2, JSON.stringify([entry('legacy-ok')]));
    const r2 = await store.repair(K2, [entry('x')]);
    out.legacyKept = localStorage.getItem(K2) !== null;
    out.mergedWithLegacy = (await store.read(K2)).map(e => e.id).sort();
    out.noBackupInLocalStorage = localStorage.getItem(r2.backupKey) === null;
    return out;
  });
  await browser.close();
  const failures = Object.keys(expected).filter(key => JSON.stringify(result[key]) !== JSON.stringify(expected[key]));
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) { console.error('FAILED: ' + failures.join(', ')); process.exit(1); }
  console.log('OK: queue repair verified in real Chromium');
})().catch(error => { console.error(error); process.exit(1); });

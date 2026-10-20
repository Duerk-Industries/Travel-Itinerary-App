// Private bundles belong to an account-scoped database, never service-worker caches.
const DATABASE = 'wanderbunnies-private-offline-v1';
const STORE = 'snapshots';
let opening: Promise<IDBDatabase> | undefined;
const open = (): Promise<IDBDatabase> => {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Offline storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other WanderBunnies tabs and try again.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
};
const transaction = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    // Request success is not a durable commit. Wait for the transaction.
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Offline storage transaction was interrupted.'));
    tx.onerror = () => reject(tx.error || new Error('Offline storage is full or unavailable.'));
  });
};
export const readAsyncOrThrow = async (key: string): Promise<string | null> =>
  (await transaction<string | undefined>('readonly', store => store.get(key))) ?? null;
export const writeAsyncOrThrow = async (key: string, value: string): Promise<void> => {
  await transaction('readwrite', store => store.put(value, key));
};
export const removeAsyncOrThrow = async (key: string): Promise<void> => {
  await transaction('readwrite', store => store.delete(key));
  // Remove any older account-keyed browser copy on explicit logout too.
  localStorage.removeItem(key);
};

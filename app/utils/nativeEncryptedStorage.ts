import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Files from 'expo-file-system/legacy';
import Constants from 'expo-constants';

/** One encrypted database and device key per account/environment storage key.
 * Never open an existing file with a newly generated key. In particular, a
 * restored expense database must not become an apparently empty queue. */
export class NativeStorageRecoveryError extends Error {
  readonly code = 'NATIVE_STORAGE_RECOVERY';
  constructor(public readonly reason: 'key-lost' | 'unreadable' | 'version') {
    super(reason === 'key-lost'
      ? 'The device encryption key is unavailable. Download trips again when online. Unsynced expenses cannot be decrypted without the original key; their encrypted copy is preserved. Do not clear app storage.'
      : 'Encrypted device storage could not be read. The original is preserved. Download trips again when online; keep saved expense recovery copies.');
  }
}

const pending = new Map<string, Promise<unknown>>();
export const serializeNativeStorage = <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  pending.set(key, next);
  void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => undefined);
  return next;
};

const location = async (scope: string) => {
  const id = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
  return { directory: `${SQLite.defaultDatabaseDirectory}/encrypted-${id}`, keyId: `wb.storage.v1.${id}` };
};
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Must be called within serializeNativeStorage(scope). All operations on the
 * connection use the same SQLCipher key, including schema and queue leases. */
export const withNativeDatabase = async <T>(scope: string, work: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> => {
  if (Constants.expoConfig?.extra?.nativeEncryptedStorage === false) {
    throw new Error('Encrypted native storage is disabled for this build.');
  }
  const { directory, keyId } = await location(scope);
  let key = await SecureStore.getItemAsync(keyId, options);
  const existing = await Files.getInfoAsync(`${directory}/store.db`);
  if (!key && existing.exists) throw new NativeStorageRecoveryError('key-lost');
  if (!key) {
    key = Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
    // Commit the key first; a failed key write must never create ciphertext.
    await SecureStore.setItemAsync(keyId, key, options);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new NativeStorageRecoveryError('key-lost');
  await Files.makeDirectoryAsync(directory, { intermediates: true });
  const db = await SQLite.openDatabaseAsync('store.db', { useNewConnection: true }, directory);
  try {
    await db.execAsync(`PRAGMA key = '${key}';`);
    const cipher = await db.getFirstAsync<Record<string, unknown>>('PRAGMA cipher_version');
    if (!cipher || !Object.values(cipher).some(value => typeof value === 'string' && value.length > 0)) {
      throw new Error('SQLCipher is unavailable. Install a native build with encrypted storage support.');
    }
    let version: { user_version: number } | null;
    try { version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'); }
    catch { throw new NativeStorageRecoveryError('unreadable'); }
    if ((version?.user_version ?? 0) > 1) throw new NativeStorageRecoveryError('version');
    await db.execAsync('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
    try {
      await db.execAsync('CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version = 1;');
      const result = await work(db);
      await db.execAsync('COMMIT;');
      return result;
    } catch (error) { await db.execAsync('ROLLBACK;').catch(() => undefined); throw error; }
  } finally { await db.closeAsync(); }
};

export const readNativeValue = async (db: SQLite.SQLiteDatabase, key = 'value'): Promise<string | null> =>
  (await db.getFirstAsync<{ value: string }>('SELECT value FROM storage WHERE key = ?', key))?.value ?? null;
export const writeNativeValue = async (db: SQLite.SQLiteDatabase, value: string, key = 'value'): Promise<void> => {
  await db.runAsync('INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)', key, value);
};

/** Snapshot-only recovery. Move the entire closed directory, including any
 * journals, before retiring its key. Never used for unsynced financial work. */
export const quarantineNativeSnapshot = async (scope: string): Promise<void> => {
  if (!scope.startsWith('stp.offline-trip-cache.')) throw new Error('Only trip snapshots can be downloaded again.');
  const { directory, keyId } = await location(scope);
  if ((await Files.getInfoAsync(directory)).exists) {
    await Files.moveAsync({ from: directory, to: `${directory}.unreadable-${Crypto.randomUUID()}` });
  }
  await SecureStore.deleteItemAsync(keyId, options);
};

/** Explicit logout removes snapshot ciphertext and its device key, never queues. */
export const eraseNativeSnapshot = async (scope: string): Promise<void> => {
  if (!scope.startsWith('stp.offline-trip-cache.')) throw new Error('Only trip snapshots can be erased here.');
  const { directory, keyId } = await location(scope);
  if ((await Files.getInfoAsync(`${directory}/store.db`)).exists) {
    await SQLite.deleteDatabaseAsync('store.db', directory);
  }
  await SecureStore.deleteItemAsync(keyId, options);
};

/** Ciphertext only, never a key. Useful for preserving a lost-key queue, but
 * cannot recover its plaintext without the original device key. */
export const exportNativeCiphertext = async (scope: string): Promise<string | null> => {
  const { directory } = await location(scope);
  const files: Record<string, string> = {};
  for (const name of ['store.db', 'store.db-journal', 'store.db-wal', 'store.db-shm']) {
    const path = `${directory}/${name}`;
    if ((await Files.getInfoAsync(path)).exists) files[name] = await Files.readAsStringAsync(path, { encoding: Files.EncodingType.Base64 });
  }
  return Object.keys(files).length ? JSON.stringify({ format: 'sqlcipher-v1', files }) : null;
};

/** @jest-environment node */
import { replayTransactionalPending } from '../utils/transactionalPendingReplay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Files from 'expo-file-system/legacy';
import { transactionalPendingWriteStore as store } from '../utils/pendingWriteStore.native';
import * as snapshots from '../utils/offlineSnapshotStorage.native';
import { NativeStorageRecoveryError, serializeNativeStorage, withNativeDatabase, writeNativeValue } from '../utils/nativeEncryptedStorage';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('expo-crypto', () => {
  const crypto = require('node:crypto');
  return { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' },
    digestStringAsync: async (_: string, value: string) => crypto.createHash('sha256').update(value).digest('hex'),
    getRandomBytesAsync: async (size: number) => crypto.randomBytes(size) };
});
jest.mock('expo-secure-store', () => {
  const keys = new Map<string, string>();
  return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6, keys,
    getItemAsync: jest.fn(async (key: string) => keys.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { keys.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { keys.delete(key); }) };
});
jest.mock('expo-file-system/legacy', () => {
  const paths = new Set<string>();
  return { paths, EncodingType: { Base64: 'base64' },
    getInfoAsync: jest.fn(async (path: string) => ({ exists: paths.has(path) })),
    makeDirectoryAsync: jest.fn(async (path: string) => { paths.add(path); }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      for (const path of [...paths]) if (path === from || path.startsWith(from + '/')) { paths.delete(path); paths.add(to + path.slice(from.length)); }
    }), readAsStringAsync: jest.fn(async () => 'encrypted-bytes') };
});
jest.mock('expo-sqlite', () => {
  // Real SQLite transactions; cipher capability/key checking are mocked here.
  // Only the device acceptance run can prove ciphertext at rest.
  const sqlReady = require('sql.js/dist/sql-wasm-inline.js')();
  const dbs = new Map();
  const controls = { failCommit: false, cipher: true, failRead: false };
  return { controls, dbs, defaultDatabaseDirectory: 'file:///sqlite',
    deleteDatabaseAsync: async (_name: string, directory: string) => { require('expo-file-system/legacy').paths.delete(directory + '/store.db'); dbs.delete(directory + '/store.db'); },
    openDatabaseAsync: jest.fn(async (_name: string, _options: unknown, directory: string) => {
      const SQL = await sqlReady;
      const fs = require('expo-file-system/legacy');
      const path = directory + '/store.db';
      if (!fs.paths.has(path)) { dbs.set(path, { db: new SQL.Database(), key: null }); fs.paths.add(path); }
      const record = dbs.get(path);
      let key: string | null = null;
      return {
        execAsync: async (sql: string) => {
          if (sql.startsWith('PRAGMA key')) { key = sql; if (!record.key) record.key = key; return; }
          if (sql === 'COMMIT;' && controls.failCommit) throw new Error('disk full');
          record.db.exec(sql);
        },
        getFirstAsync: async (sql: string, ...params: unknown[]) => {
          if (sql === 'PRAGMA cipher_version') return controls.cipher ? { cipher_version: '4.0' } : null;
          if (key !== record.key || controls.failRead) throw new Error('not a database');
          const result = record.db.exec(sql, params)[0];
          return result?.values[0] ? Object.fromEntries(result.columns.map((name: string, index: number) => [name, result.values[0][index]])) : null;
        },
        runAsync: async (sql: string, ...params: unknown[]) => record.db.run(sql, params),
        closeAsync: async () => undefined,
      };
    }) };
});

const sqlite = jest.requireMock('expo-sqlite');
const keys: Map<string, string> = jest.requireMock('expo-secure-store').keys;
const paths: Set<string> = jest.requireMock('expo-file-system/legacy').paths;
const removeItem = jest.mocked(AsyncStorage.removeItem).getMockImplementation()!;
const key = 'stp.pending-expenses.server.owner';
const entry = { id: 'id', kind: 'expense', args: { operationKey: 'stable' }, enqueuedAtMs: 1, attempts: 0 };
beforeEach(async () => {
  jest.mocked(AsyncStorage.removeItem).mockImplementation(removeItem);
  await AsyncStorage.clear(); keys.clear(); paths.clear(); sqlite.dbs.clear();
  sqlite.controls.failCommit = false; sqlite.controls.cipher = true; sqlite.controls.failRead = false;
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

it('migrates the original operation keys and removes plaintext only after commit', async () => {
  await AsyncStorage.setItem(key, JSON.stringify([entry]));
  expect(await store.read(key)).toEqual([entry]);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^[a-f0-9]{64}$/), expect.objectContaining({ keychainAccessible: 6 }));
  expect(await store.read(key)).toEqual([entry]);
});
it('rolls back disk-full migration and retries without losing the source', async () => {
  await AsyncStorage.setItem(key, JSON.stringify([entry])); sqlite.controls.failCommit = true;
  await expect(store.read(key)).rejects.toThrow('disk full');
  expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify([entry]));
  sqlite.controls.failCommit = false;
  expect(await store.read(key)).toEqual([entry]);
});
it('does not create ciphertext when SecureStore fails', async () => {
  jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('locked'));
  await expect(store.read(key)).rejects.toThrow('locked');
  expect(paths.size).toBe(0);
});
it('fails closed on missing or wrong keys and exports ciphertext without regenerating the key', async () => {
  await store.update(key, () => [entry]); keys.clear(); jest.clearAllMocks();
  await expect(store.read(key)).rejects.toBeInstanceOf(NativeStorageRecoveryError);
  await expect(store.update(key, () => [])).rejects.toThrow('key');
  await expect(store.repair!(key, [entry])).rejects.toThrow('key');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(JSON.parse((await store.recovery(key))!).encrypted).toContain('encrypted-bytes');
  expect(Files.moveAsync).not.toHaveBeenCalled();
  const id = [...paths].find(path => path.endsWith('/store.db'))!.split('encrypted-')[1].split('/')[0];
  keys.set('wb.storage.v1.' + id, 'f'.repeat(64));
  await expect(store.read(key)).rejects.toThrow('preserved');
});
it('rejects a binary without SQLCipher instead of writing plaintext', async () => {
  sqlite.controls.cipher = false;
  await expect(store.update(key, () => [entry])).rejects.toThrow('SQLCipher');
});
it('serializes concurrent enqueues and fences lease owners', async () => {
  await Promise.all([store.update(key, rows => [...rows, entry]), store.update(key, rows => [...rows, { ...entry, id: 'two' }])]);
  expect((await store.read(key)).length).toBe(2);
  expect(await store.read(key + '.other-account')).toEqual([]);
  expect(await store.claim(key, 'one', 30_000)).toBe(true);
  expect(await store.claim(key, 'two', 30_000)).toBe(false);
  await expect(store.update(key, () => [], 'two')).rejects.toThrow('lease');
  await store.release(key, 'two'); expect(await store.renew(key, 'one', 30_000)).toBe(true);
  const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 60_000);
  expect(await store.claim(key, 'two', 30_000)).toBe(true);
  await expect(store.update(key, () => [], 'one')).rejects.toThrow('lease');
});
it('retains tombstones when legacy cleanup fails, and isolates accounts', async () => {
  await AsyncStorage.setItem(key, JSON.stringify([entry]));
  jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('interrupted'));
  await store.read(key); await store.update(key, () => []);
  expect(await store.read(key)).toEqual([]);
  expect(await store.read(key + 'other')).toEqual([]);
});
it('backs up malformed migration data before repair', async () => {
  await AsyncStorage.setItem(key, '[broken');
  await expect(store.read(key)).rejects.toThrow('Unreadable');
  const repaired = await store.repair!(key, [entry]);
  const backup = await serializeNativeStorage(key, () => withNativeDatabase(key, async db =>
    db.getFirstAsync<{ value: string }>('SELECT value FROM storage WHERE key = ?', repaired.backupKey)));
  expect(backup?.value).toContain('[broken');
  expect(await store.read(key)).toEqual([entry]);
});
it('does not reintroduce already handled entries during repair', async () => {
  await store.update(key, () => [entry]); await store.update(key, () => []);
  expect(await store.repair!(key, [entry])).toMatchObject({ written: 0, alreadyHandled: 1 });
});
it('migrates snapshots, and quarantines only snapshots after key loss', async () => {
  const snapshotKey = 'stp.offline-trip-cache.v2.server.owner';
  const legacy = JSON.stringify({ version: 2, ownerId: 'owner', environment: 'server', accessExpiresAt: Date.now(), trips: [], groups: [], snapshots: {} });
  await AsyncStorage.setItem(snapshotKey, legacy);
  expect(await snapshots.readAsyncOrThrow(snapshotKey)).toBe(legacy);
  expect(await AsyncStorage.getItem(snapshotKey)).toBeNull();
  keys.clear(); expect(await snapshots.readAsyncOrThrow(snapshotKey)).toBeNull();
  await snapshots.writeAsyncOrThrow(snapshotKey, '{"fresh":true}');
  expect(Files.moveAsync).toHaveBeenCalledTimes(1);
  expect(await snapshots.readAsyncOrThrow(snapshotKey)).toBe('{"fresh":true}');
});
it('erases snapshot keys on logout and never overwrites a future schema', async () => {
  const snapshotKey = 'stp.offline-trip-cache.v2.server.owner';
  await snapshots.writeAsyncOrThrow(snapshotKey, '{}');
  await snapshots.removeAsyncOrThrow(snapshotKey);
  expect(keys.size).toBe(0);
  expect([...paths].some(path => path.endsWith('/store.db'))).toBe(false);
  expect(await snapshots.readAsyncOrThrow(snapshotKey)).toBeNull();
  await serializeNativeStorage(key, () => withNativeDatabase(key, async db => {
    await writeNativeValue(db, '{}'); await db.execAsync('PRAGMA user_version = 2;');
  }));
  await expect(store.read(key)).rejects.toMatchObject({ reason: 'version' });
});

it('keeps corrupt legacy data when repair commit fails', async () => {
  await AsyncStorage.setItem(key, '[broken'); sqlite.controls.failCommit = true;
  await expect(store.repair!(key, [entry])).rejects.toThrow('disk full');
  expect(await AsyncStorage.getItem(key)).toBe('[broken');
  sqlite.controls.failCommit = false;
  await store.repair!(key, [entry]);
  expect(await store.read(key)).toEqual([entry]);
});
it('does not migrate a snapshot belonging to another immutable owner', async () => {
  const snapshotKey = 'stp.offline-trip-cache.v2.server.owner';
  const wrong = JSON.stringify({ version: 2, ownerId: 'another', environment: 'server', accessExpiresAt: Date.now(), trips: [], groups: [], snapshots: {} });
  await AsyncStorage.setItem(snapshotKey, wrong);
  expect(await snapshots.readAsyncOrThrow(snapshotKey)).toBeNull();
  expect(await AsyncStorage.getItem(snapshotKey)).toBe(wrong);
});

it('resumes the native transactional queue after suspension and abandoned-lease expiry', async () => {
  await store.update(key, () => [entry, { ...entry, id: 'two', args: { operationKey: 'stable-two' } }]);
  let foreground = true;
  const run = (token: string, replay: Parameters<typeof replayTransactionalPending>[0]['replay']) =>
    replayTransactionalPending({ store, key, token, current: () => foreground, maxAttempts: null, replay });
  await run('suspended', async () => { foreground = false; return true; });
  expect(await store.read(key)).toHaveLength(2);
  foreground = true;
  expect(await store.claim(key, 'killed-process', 30_000)).toBe(true);
  const send = jest.fn(async () => true);
  await run('resume', send); expect(send).not.toHaveBeenCalled();
  const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 30_001);
  const summary = await run('relaunch', send);
  expect(summary).toMatchObject({ replayed: 2, remaining: 0, dropped: 0 });
  expect(send.mock.calls.map(call => (call as unknown as [typeof entry])[0].args.operationKey)).toEqual(['stable', 'stable-two']);
  expect(await store.read(key)).toEqual([]);
});

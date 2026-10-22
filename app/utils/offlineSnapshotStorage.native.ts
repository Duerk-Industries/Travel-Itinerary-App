import { parseCache } from './offlineTripCacheValidation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStorageRecoveryError, eraseNativeSnapshot, quarantineNativeSnapshot, readNativeValue, serializeNativeStorage, withNativeDatabase, writeNativeValue } from './nativeEncryptedStorage';

export const readAsyncOrThrow = (key: string): Promise<string | null> => serializeNativeStorage(key, async () => {
  try {
    const legacy = await AsyncStorage.getItem(key);
    const value = await withNativeDatabase(key, async db => {
      let stored = await readNativeValue(db);
      if (await readNativeValue(db, 'legacy-migrated') === null) {
        if (stored === null && legacy !== null) {
          // Environment URLs and user IDs may contain literal dots: reconstruct
          // the key from the payload instead of splitting that ambiguous format.
          let parsed: { ownerId?: string; environment?: string };
          try { parsed = JSON.parse(legacy); } catch { throw new NativeStorageRecoveryError('unreadable'); }
          const owner = { userId: parsed?.ownerId ?? '', environment: parsed?.environment ?? '' };
          const expected = `stp.offline-trip-cache.v2.${encodeURIComponent(owner.environment)}.${encodeURIComponent(owner.userId)}`;
          if (key !== expected || !parseCache(legacy, owner)) throw new NativeStorageRecoveryError('unreadable');
          if (legacy.length > 5_000_000) throw new Error('Saved trip migration is too large. Download again.');
          await writeNativeValue(db, legacy); stored = legacy;
        }
        await writeNativeValue(db, '1', 'legacy-migrated');
      }
      return stored;
    });
    if (legacy !== null) await AsyncStorage.removeItem(key);
    return value;
  }
  catch (error) {
    if (error instanceof NativeStorageRecoveryError && error.reason !== 'version') return null;
    throw error;
  }
});

export const writeAsyncOrThrow = (key: string, value: string): Promise<void> => serializeNativeStorage(key, async () => {
  const write = () => withNativeDatabase(key, async db => {
    await writeNativeValue(db, value);
    await writeNativeValue(db, '1', 'legacy-migrated');
  });
  try { await write(); }
  catch (error) {
    if (!(error instanceof NativeStorageRecoveryError) || error.reason === 'version') throw error;
    await quarantineNativeSnapshot(key);
    await write();
  }
  // Online download has committed before the unencrypted legacy copy is removed.
  await AsyncStorage.removeItem(key);
});

export const removeAsyncOrThrow = (key: string): Promise<void> => serializeNativeStorage(key, async () => {
  // Remove the plaintext source first so it cannot resurrect after logout.
  await AsyncStorage.removeItem(key);
  if (!key.startsWith('stp.offline-trip-cache.v1.')) await eraseNativeSnapshot(key);
});

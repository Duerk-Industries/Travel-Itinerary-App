import { eraseNativeReadCache, readNativeValue, serializeNativeStorage, withNativeDatabase, writeNativeValue } from '../utils/nativeEncryptedStorage';
export const read = (key: string): Promise<string | null> => serializeNativeStorage(key, () => withNativeDatabase(key, db => readNativeValue(db)));
export const write = (key: string, value: string): Promise<void> => serializeNativeStorage(key, () => withNativeDatabase(key, db => writeNativeValue(db, value)));
export const remove = (key: string): Promise<void> => serializeNativeStorage(key, () => eraseNativeReadCache(key));

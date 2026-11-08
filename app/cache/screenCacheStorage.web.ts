// Private browser data uses IndexedDB, never a service-worker response cache.
export { readAsyncOrThrow as read, writeAsyncOrThrow as write, removeAsyncOrThrow as remove } from '../utils/offlineSnapshotStorage.web';

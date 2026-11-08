// Non-platform tooling/Jest fallback. Native and web builds resolve their own files.
export { readAsyncOrThrow as read, writeAsyncOrThrow as write, removeAsyncOrThrow as remove } from '../utils/persistentStorage';

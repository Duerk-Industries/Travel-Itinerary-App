// Lightweight bridge to the already-loaded assistant. Never imports or loads WebLLM.
export type ActivityDescriptionInput = { name: string; location: string; notes: string };
type Generator = (input: ActivityDescriptionInput) => Promise<string>;
let generator: Generator | null = null;
let busy = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const subscribeLocalDescriptions = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const localDescriptionsAvailable = () => generator !== null && !busy;
export const localAiBusy = () => busy;
export function registerLocalDescriptions(next: Generator) {
  generator = next; notify();
  return () => { if (generator === next) { generator = null; notify(); } };
}
export async function withLocalAiLock<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('The local AI is busy. Try again when it finishes.');
  busy = true; notify();
  try { return await operation(); }
  finally { busy = false; notify(); }
}
export function generateLocalActivityDescription(input: ActivityDescriptionInput): Promise<string> {
  const current = generator;
  if (!current) return Promise.reject(new Error('The local AI is not loaded.'));
  return withLocalAiLock(() => current(input));
}

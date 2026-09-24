import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type AutosaveState = {
  status: AutosaveStatus;
  savedAt: number | null;
  error: string | null;
};

type PendingEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  run: (() => Promise<void>) | null;
};

const DEFAULT_DELAY_MS = 1500;
const IDLE_STATE: AutosaveState = { status: 'idle', savedAt: null, error: null };

// Debounced, per-key autosave scheduler — FR-A5.1 ("Text edits autosave 1.5s after the last
// keystroke, and on blur, and on tab change") and FR-A5.2 (a visible Saving…/Saved/Not saved
// state). One instance covers every editable field on a page — a day's headline, its summary,
// the blog masthead, and an item body — so switching between fields never fights over a single
// shared timer; each field schedules and flushes under its own key.
//
// The hook only schedules and reports status. Conflict handling (a 409 mid-save) is the caller's
// responsibility: `run` should reject with whatever shape the caller wants to inspect, and the
// caller reads that from the rejected promise via its own conflict state, keyed the same way this
// hook keys its status map — see the "Keep mine / Use theirs / Show both" contract in
// docs/trip-blog-social-architecture.md §5.5, implemented in BlogConflictBanner.tsx.
export function useAutosave(delayMs: number = DEFAULT_DELAY_MS) {
  const pending = useRef<Map<string, PendingEntry>>(new Map());
  const [states, setStates] = useState<Record<string, AutosaveState>>({});

  const setState = useCallback((key: string, patch: Partial<AutosaveState>) => {
    setStates((current) => ({
      ...current,
      [key]: { ...IDLE_STATE, ...current[key], ...patch },
    }));
  }, []);

  const runNow = useCallback(async (key: string) => {
    const entry = pending.current.get(key);
    if (!entry || !entry.run) return;
    const run = entry.run;
    entry.run = null;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    setState(key, { status: 'saving', error: null });
    try {
      await run();
      setState(key, { status: 'saved', savedAt: Date.now(), error: null });
    } catch (error: any) {
      // A conflict (409) is still a caught error at this layer — the caller's `run` is expected
      // to have already recorded whatever conflict payload it needs before rejecting, since this
      // hook has no opinion on what a conflict looks like for a given field type.
      setState(key, { status: 'error', error: error?.message || 'Not saved — retrying' });
      throw error;
    }
  }, [setState]);

  // Debounced entry point: resets the timer if called again for the same key before it fires.
  const schedule = useCallback((key: string, run: () => Promise<void>) => {
    let entry = pending.current.get(key);
    if (!entry) {
      entry = { timer: null, run: null };
      pending.current.set(key, entry);
    }
    entry.run = run;
    if (entry.timer) clearTimeout(entry.timer);
    setState(key, { status: 'pending' });
    entry.timer = setTimeout(() => {
      void runNow(key).catch(() => {
        // Swallow here — schedule() is fire-and-forget by design (callers that need to react to
        // a rejection use flush() directly, which does propagate).
      });
    }, delayMs);
  }, [delayMs, setState]);

  // Bypasses the debounce timer and saves immediately — used on blur, on tab change, and by the
  // conflict banner's "Keep mine" retry (FR-A5.1, architecture §5.5).
  const flush = useCallback((key: string) => runNow(key), [runNow]);

  const flushAll = useCallback(async () => {
    const keys = Array.from(pending.current.keys());
    await Promise.all(keys.map((key) => runNow(key).catch(() => {})));
  }, [runNow]);

  const cancel = useCallback((key: string) => {
    const entry = pending.current.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    pending.current.delete(key);
    setState(key, { ...IDLE_STATE });
  }, [setState]);

  // Best-effort flush of anything still pending when the field/tab unmounts, so a debounce timer
  // that hadn't fired yet doesn't just vanish (the "on tab change" half of FR-A5.1). This can't be
  // awaited from a synchronous cleanup function; the underlying fetch still completes in the
  // background the same way every other fire-and-forget call in this codebase does.
  useEffect(() => () => { void flushAll(); }, [flushAll]);

  return { schedule, flush, flushAll, cancel, states };
}

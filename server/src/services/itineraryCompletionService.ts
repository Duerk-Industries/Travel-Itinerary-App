import { completeEndedItineraryItems } from '../db';
import { logError, logInfo } from '../logger';

// A booked item becomes Completed once the last day it covers is over: a flight on its arrival day, a lodging on
// check-out day, a car rental on drop-off day, an activity on its day. Something that spans days is left alone
// until the day after its final day.
//
// Items carry calendar dates but no time zone, so "over" is judged in the zone furthest behind the Americas: a day
// counts as finished 12 hours after UTC midnight, which is after midnight in every zone from UTC-12 to UTC-1 and
// later (never early) for the rest. Running twice is harmless, so every instance may run it.

const HOUR_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = HOUR_MS;
const DAY_OVER_AFTER_UTC_MIDNIGHT_HOURS = 12;

/** The first date that is not yet over: items ending before it are finished. */
export const firstUnfinishedDay = (now: Date = new Date()): string =>
  new Date(now.getTime() - DAY_OVER_AFTER_UTC_MIDNIGHT_HOURS * HOUR_MS).toISOString().slice(0, 10);

export const completeEndedItems = async (now: Date = new Date()): Promise<number> => {
  const completed = await completeEndedItineraryItems(firstUnfinishedDay(now));
  if (completed > 0) logInfo(`[itinerary-completion] marked ${completed} item(s) Completed`);
  return completed;
};

let handle: ReturnType<typeof setInterval> | null = null;

export const startItineraryCompletionScheduler = (): boolean => {
  if (handle || process.env.NODE_ENV === 'test') return false;
  const run = () => completeEndedItems().catch((err) => logError('[itinerary-completion] sweep failed', err));
  void run();
  handle = setInterval(run, SWEEP_INTERVAL_MS);
  handle.unref();
  return true;
};

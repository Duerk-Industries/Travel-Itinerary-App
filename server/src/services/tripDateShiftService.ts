import type { NextFunction, Request, Response } from 'express';
import {
  clearTripEstimatedItems,
  listActivities,
  listFlights,
  listLodgings,
  listTripEstimatedItems,
  removeTripEstimatedItem,
  updateActivity,
  updateFlight,
  updateLodging,
  type EstimatedItemType,
} from '../db';
import { logError, logInfo } from '../logger';

const DAY_MS = 24 * 60 * 60 * 1000;

// The Postgres adapter hands lodging and transfer dates back as Date objects (local midnight from node-pg,
// UTC midnight from pg-mem), Firestore as strings.
const isoDay = (value: unknown): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return '';
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0) return value.toISOString().slice(0, 10);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value ?? '').slice(0, 10);
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${isoDay(to)}T00:00:00Z`) - Date.parse(`${isoDay(from)}T00:00:00Z`)) / DAY_MS);

const shifted = (value: unknown, days: number): string | undefined => {
  const day = isoDay(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
};

/** An edit the traveler saves on an item takes it off the list of dates that move with the trip. */
export const confirmItemDates = async (type: EstimatedItemType, itemId: string): Promise<void> => {
  await removeTripEstimatedItem(type, itemId);
};

/**
 * Express middleware for an item router: once a traveler's save (`PUT|PATCH /:id`) succeeds, that item's
 * dates are theirs and no longer move with the trip. Never blocks or fails the response.
 */
export const confirmEditedItem = (type: EstimatedItemType) => (req: Request, res: Response, next: NextFunction): void => {
  const method = req.method.toUpperCase();
  const match = /^\/([^/]+)\/?$/.exec(req.path);
  if ((method === 'PUT' || method === 'PATCH') && match) {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      confirmItemDates(type, decodeURIComponent(match[1])).catch((err) => logError('[trip-dates] could not confirm item dates', err));
    });
  }
  next();
};

/**
 * Moves the items a template placed against a placeholder start by `deltaDays`, once real dates are set.
 * Items the traveler has saved themselves are no longer marked and stay on the dates they confirmed.
 * Day-plan items are tied to day numbers, so they follow the trip without being touched.
 */
export const shiftEstimatedItems = async (userId: string, tripId: string, deltaDays: number): Promise<{ shifted: number }> => {
  const marked = await listTripEstimatedItems(tripId);
  if (!marked.length) return { shifted: 0 };
  const ids = (type: EstimatedItemType) => new Set(marked.filter((item) => item.type === type).map((item) => item.id));
  let count = 0;
  const attempt = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      count += 1;
    } catch (err) {
      logError(`[trip-dates] could not move ${label}`, err);
    }
  };

  if (deltaDays !== 0) {
    const activityIds = ids('activity');
    if (activityIds.size) {
      for (const activity of (await listActivities(userId, tripId)).filter((a) => activityIds.has(String(a.id)))) {
        const date = shifted(activity.date, deltaDays);
        if (date) await attempt(`activity ${activity.id}`, () => updateActivity(String(activity.id), userId, { date } as any));
      }
    }
    const lodgingIds = ids('lodging');
    if (lodgingIds.size) {
      for (const lodging of (await listLodgings(userId, tripId)).filter((l) => lodgingIds.has(String(l.id)))) {
        const checkIn = shifted((lodging as any).checkInDate ?? lodging.check_in_date, deltaDays);
        const checkOut = shifted((lodging as any).checkOutDate ?? lodging.check_out_date, deltaDays);
        if (checkIn && checkOut) await attempt(`lodging ${lodging.id}`, () => updateLodging(String(lodging.id), userId, { check_in_date: checkIn, check_out_date: checkOut } as any));
      }
    }
    const transferIds = ids('transfer');
    if (transferIds.size) {
      for (const flight of (await listFlights(userId, tripId)).filter((f) => transferIds.has(String(f.id)))) {
        const departureDate = shifted(flight.departureDate, deltaDays);
        const arrivalDate = shifted(flight.arrivalDate, deltaDays);
        if (departureDate && arrivalDate) await attempt(`transfer ${flight.id}`, () => updateFlight(String(flight.id), userId, { departureDate, arrivalDate } as any));
      }
    }
  }
  // The dates are real now: whatever is left stays where it is, and later edits are the traveler's own.
  await clearTripEstimatedItems(tripId);
  logInfo(`[trip-dates] moved ${count} suggested item(s) on trip ${tripId} by ${deltaDays} day(s)`);
  return { shifted: count };
};

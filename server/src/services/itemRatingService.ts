import { castStarRating, getStarRatingSummaries, getTripById } from '../db';
import type { VoteItemType } from './itemVoteService';

// Travelers rate a booked item 1-5 stars. The rating belongs to the item (so each person's own rating can be shown
// back to them) and also to the provider behind it, so every traveler's ratings of the same hotel, airline, rental
// company or activity average together. The count behind an average and when a rating last changed are kept in the
// database but not sent to clients yet.

export const MIN_STARS = 1;
export const MAX_STARS = 5;

const normalize = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type ProviderContext = {
  /** The trip's destination, used to tell apart hotels that share a name when no address was entered. */
  destination?: string | null;
};

/**
 * Who the item is a booking of: a hotel (its name and address; with no address, its name and the trip destination;
 * with neither, just its name), an airline or other carrier, a car rental company, or an activity (its catalog
 * entry, else its name). An item that names none of these is its own provider, so it still keeps the traveler's
 * rating without being averaged with unrelated bookings.
 */
export const providerKeyFor = (itemType: VoteItemType, item: Record<string, any>, context: ProviderContext = {}): string => {
  const own = `item:${String(item.id ?? '')}`;
  const named = (prefix: string, value: unknown): string => {
    const key = normalize(value);
    return key ? `${prefix}:${key}` : own;
  };
  switch (itemType) {
    case 'lodging': {
      const name = normalize(item.name);
      if (!name) return own;
      const address = normalize(item.address);
      if (address) return `hotel:${name}|${address}`;
      const destination = normalize(context.destination);
      return destination ? `hotel:${name}|in ${destination}` : `hotel:${name}`;
    }
    case 'flight':
      return named('carrier', item.carrier);
    case 'car_rental':
      return named('vendor', item.vendor);
    case 'activity': {
      const catalogId = String(item.catalogId ?? item.catalog_id ?? '').trim();
      return catalogId ? `catalog:${catalogId.toLowerCase()}` : named('name', item.name);
    }
  }
};

/** Only hotels without an address need the trip's destination, so other items skip the trip lookup. */
export const providerContextFor = async (tripId: string, itemType: VoteItemType, items: Array<Record<string, any>>): Promise<ProviderContext> => {
  if (itemType !== 'lodging' || items.every((item) => normalize(item.address) || !normalize(item.name))) return {};
  return { destination: (await getTripById(tripId))?.destination ?? null };
};

const roundAverage = (average: number | null): number | null => (average === null ? null : Math.round(average * 100) / 100);

/** Adds `averageRating` (null until rated) and the requesting traveler's own `userRating` (1-5 or null). */
export const applyStarRatings = async <T extends { id: string }>(
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  items: T[]
): Promise<Array<T & { averageRating: number | null; userRating: number | null }>> => {
  if (!items.length) return [];
  const context = await providerContextFor(tripId, itemType, items as Array<Record<string, any>>);
  const summaries = await getStarRatingSummaries(
    userId,
    itemType,
    items.map((item) => ({ itemId: String(item.id), providerKey: providerKeyFor(itemType, item as Record<string, any>, context) }))
  );
  return items.map((item) => {
    const summary = summaries[String(item.id)];
    return { ...item, averageRating: roundAverage(summary?.average ?? null), userRating: summary?.userStars ?? null };
  });
};

/** Records the traveler's rating of an item and returns what the item now shows. */
export const rateItem = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  item: { id: string } & Record<string, any>,
  stars: number
): Promise<{ itemId: string; averageRating: number | null; userRating: number | null }> => {
  const context = await providerContextFor(tripId, itemType, [item]);
  await castStarRating(userId, tripId, itemType, String(item.id), providerKeyFor(itemType, item, context), stars);
  const [rated] = await applyStarRatings(userId, tripId, itemType, [item]);
  return { itemId: String(item.id), averageRating: rated.averageRating, userRating: rated.userRating };
};

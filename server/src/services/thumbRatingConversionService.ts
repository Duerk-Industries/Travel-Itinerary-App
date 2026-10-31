import { castStarRating, deleteLegacyThumbRatings, getActivityById, getCarRentalById, getFlightById, getLodgingById, hasStarRating, listLegacyThumbRatings } from '../db';
import { logError, logInfo } from '../logger';
import { providerContextFor, providerKeyFor } from './itemRatingService';
import type { VoteItemType } from './itemVoteService';

// Before star ratings, a completed item was rated with a thumb. Each thumb becomes a star rating once (up is 5 stars,
// down is 1), keeping the date the traveler last changed it, and the thumb is removed so this never repeats. A thumb
// whose item has been deleted is dropped, and a traveler who has already starred the item keeps their stars.

const BATCH_SIZE = 500;
const THUMB_STARS = { up: 5, down: 1 } as const;

const loadItem = async (itemType: VoteItemType, itemId: string): Promise<(Record<string, any> & { id: string }) | null> => {
  switch (itemType) {
    case 'flight': return (await getFlightById(itemId)) as any;
    case 'lodging': return (await getLodgingById(itemId)) as any;
    case 'activity': return (await getActivityById(itemId)) as any;
    case 'car_rental': return (await getCarRentalById(itemId)) as any;
  }
};

/** Converts every leftover thumb rating; returns how many became star ratings. */
export const convertThumbRatingsToStars = async (): Promise<number> => {
  let converted = 0;
  for (;;) {
    const thumbs = await listLegacyThumbRatings(BATCH_SIZE);
    if (!thumbs.length) break;
    const finished: string[] = [];
    for (const thumb of thumbs) {
      try {
        const item = await loadItem(thumb.itemType, thumb.itemId);
        if (item && !(await hasStarRating(thumb.userId, thumb.itemType, thumb.itemId))) {
          const tripId = thumb.tripId || String(item.tripId ?? item.trip_id ?? '');
          const context = await providerContextFor(tripId, thumb.itemType, [item]);
          await castStarRating(thumb.userId, tripId, thumb.itemType, thumb.itemId, providerKeyFor(thumb.itemType, item, context), thumb.thumb === 1 ? THUMB_STARS.up : THUMB_STARS.down, thumb.changedAt);
          converted += 1;
        }
        finished.push(thumb.id);
      } catch (err) {
        logError(`[thumb-ratings] could not convert ${thumb.itemType} ${thumb.itemId}`, err);
      }
    }
    // Nothing was removable (every one failed): stop rather than reread the same rows forever.
    if (!finished.length) break;
    await deleteLegacyThumbRatings(finished);
    if (thumbs.length < BATCH_SIZE) break;
  }
  if (converted > 0) logInfo(`[thumb-ratings] converted ${converted} thumb rating(s) to stars`);
  return converted;
};

export const startThumbRatingConversion = (): boolean => {
  if (process.env.NODE_ENV === 'test') return false;
  void convertThumbRatingsToStars().catch((err) => logError('[thumb-ratings] conversion failed', err));
  return true;
};

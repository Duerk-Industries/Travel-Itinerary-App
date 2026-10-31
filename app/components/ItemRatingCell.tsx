import React from 'react';
import StarRating from './StarRating';
import { normalizeStarRating } from '../utils/votes';

type Props = {
  averageRating: number | null | undefined;
  userRating: number | null | undefined;
  /** Whether the viewer may rate this item (a completed item, not in a read-only view). */
  canRate: boolean;
  onRate?: (stars: number) => void;
  /** Test ids become `${testIDPrefix}-your-rating-${id}` / `${testIDPrefix}-average-rating-${id}`. */
  testIDPrefix: string;
  id: string;
  size?: number;
};

/**
 * Once the viewer has rated an item, their own stars stand in for the provider average; until then the average
 * shows (empty stars when nobody has rated) with stars to tap when they are allowed to rate.
 */
const ItemRatingCell: React.FC<Props> = ({ averageRating, userRating, canRate, onRate, testIDPrefix, id, size = 14 }) => {
  const mine = normalizeStarRating(userRating);
  if (mine !== null) {
    return <StarRating value={mine} size={size} label="Your rating" testID={`${testIDPrefix}-your-rating-${id}`} onChange={canRate ? onRate : undefined} />;
  }
  return (
    <>
      <StarRating value={averageRating} size={size} label="Average rating" testID={`${testIDPrefix}-average-rating-${id}`} />
      {canRate && onRate ? <StarRating value={null} size={size} label="Your rating" testID={`${testIDPrefix}-your-rating-${id}`} onChange={onRate} /> : null}
    </>
  );
};

export default ItemRatingCell;

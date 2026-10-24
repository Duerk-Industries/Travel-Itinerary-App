import type { Activity } from '../../server/src/types';
import type { Lodging } from '../tabs/lodging';

export type TransferHotel = Pick<Lodging, 'id' | 'name' | 'address' | 'checkInDate' | 'checkOutDate' | 'status'>;

/** Hotel selections store the address; resolve a display name without changing the map query. */
export function transferLocationLabel(location: string, hotels: TransferHotel[], date: string, activities: TransferActivity[] = []): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const address = normalize(location);
  if (!address) return location;
  const matches = hotels.filter(hotel => normalize(hotel.address ?? '') === address && hotel.name?.trim());
  const dateMatches = hotelsForTransferDate(matches, date);
  const activityMatches = activitiesForTransferDate(activities, date).filter(activity => normalize(activity.startLocation) === address && activity.name?.trim());
  const names = [...new Set([...(dateMatches.length ? dateMatches : matches).map(hotel => hotel.name.trim()), ...activityMatches.map(activity => activity.name.trim())])];
  return names.length === 1 ? names[0] : location;
}

/** Include checkout day: a transfer can still depart from that hotel that morning. */
export function hotelsForTransferDate(hotels: TransferHotel[], date: string): TransferHotel[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const next = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(next.getTime())) return [];
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  return hotels.filter(hotel => hotel.status !== 'Cancelled' && (hotel.address ?? '').trim()
    && hotel.checkInDate && hotel.checkOutDate && hotel.checkInDate <= tomorrow && hotel.checkOutDate >= date);
}

export type TransferActivity = Pick<Activity, 'id' | 'name' | 'date' | 'startLocation' | 'status'>;

/** Activity locations are offered only on the exact selected endpoint day. */
export function activitiesForTransferDate(activities: TransferActivity[], date: string): TransferActivity[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return activities.filter(activity => activity.date === date && activity.status !== 'Cancelled' && activity.startLocation?.trim());
}

/** Keep the saved street address intact, but give map providers the hotel's name as well. */
export function transferMapLocation(location: string, hotels: TransferHotel[], date: string): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = hotels.filter(hotel => hotel.name?.trim() && normalize(hotel.address ?? '') === normalize(location));
  const dated = hotelsForTransferDate(matches, date);
  const candidates = dated.length ? dated : matches;
  const names = [...new Set(candidates.map(hotel => hotel.name.trim()))];
  return names.length === 1 ? `${names[0]}, ${location.trim()}` : location;
}

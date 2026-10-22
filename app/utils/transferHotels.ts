import type { Lodging } from '../tabs/lodging';

export type TransferHotel = Pick<Lodging, 'id' | 'name' | 'address' | 'checkInDate' | 'checkOutDate' | 'status'>;

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

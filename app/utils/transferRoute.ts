import { normalizeTransferType } from './transferTypes';
import type { IconName } from '../components/Icon';

// Short labels for a transfer's route, shared by the day card subtitle and the day view. Prefers a
// real code (EWR, LIS); ground transfers keep station names in the code field, so those fall back
// to the place name minus "(Fujikyu Railway)"-style detail. Icon follows the transfer type.
export const describeTransferRoute = (flight: {
  departure_airport_code?: string | null;
  arrival_airport_code?: string | null;
  departure_location?: string | null;
  arrival_location?: string | null;
  transfer_type?: string | null;
  transferType?: string | null;
}): { iconName: IconName; from: string; to: string; fullFrom: string; fullTo: string } => {
  const shortPlace = (code?: string | null, location?: string | null) => {
    const c = String(code ?? '').trim();
    if (/^[A-Z0-9]{3,4}$/.test(c)) return c;
    return String(c || location || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const type = normalizeTransferType(flight.transfer_type || flight.transferType);
  return {
    iconName: type === 'Flight' ? 'flight' : type === 'Private Transfer' ? 'car' : 'transfer',
    from: shortPlace(flight.departure_airport_code, flight.departure_location),
    to: shortPlace(flight.arrival_airport_code, flight.arrival_location),
    fullFrom: String(flight.departure_location || flight.departure_airport_code || '').trim(),
    fullTo: String(flight.arrival_location || flight.arrival_airport_code || '').trim(),
  };
};


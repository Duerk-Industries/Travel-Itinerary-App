import { resolveComponentTheme as resolveStyleTheme, type AppTheme } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { uiTransferCalendarEvent } from '../utils/calendarEvents';
import React, { useEffect, useState } from 'react';
import type { Flight } from '../tabs/transfers';

import type { MapApp } from '../utils/mapLinks';
import { isFlightTransfer } from '../utils/transferCategory';
import { formatFlightDetails } from '../utils/overviewBuilder';
import TripItemDetailsDialog from './TripItemDetailsDialog';
import TransferDirections from './TransferDirections';
import { ItemRating } from './StarRating';
import { canRateItem } from '../utils/votes';
import { transferLocationLabel, type TransferActivity, type TransferHotel } from '../utils/transferHotels';

type Props = {
  flight: Flight; backendUrl: string; headers: Record<string, string>;
  styles: Record<string, any>; theme?: AppTheme; readOnly?: boolean; mapApp?: MapApp;
  lodgings?: TransferHotel[]; activities?: TransferActivity[];
  onClose: () => void; onEdit: () => void; onDelete: () => void; onRate?: (stars: number) => void; testID?: string;
};
function TransferDetails({ flight, backendUrl, headers, styles, theme: _providedTheme, readOnly, mapApp, lodgings = [], activities = [], onClose, onEdit, onDelete, onRate, testID }: Props) {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [detailAirportLabels, setDetailAirportLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!flight || !isFlightTransfer(flight)) return;
    let cancelled = false;
    const codes = [...new Set([flight.departure_airport_code, flight.arrival_airport_code]
      .filter((code): code is string => Boolean(code)).map(code => code.trim().toUpperCase()))];
    void Promise.all(codes.filter(code => !detailAirportLabels[code]).map(async code => {
      try {
        const response = await fetch(`${backendUrl}/api/transfers/locations?q=${encodeURIComponent(code)}`, { headers });
        if (!response.ok) return;
        const labels: unknown = await response.json();
        const label = Array.isArray(labels) ? labels.find(value => typeof value === 'string' &&
          value.toUpperCase().includes(`(${code})`)) : undefined;
        if (!cancelled && label) setDetailAirportLabels(previous => ({ ...previous, [code]: label }));
      } catch { /* Keep the stored location available if the airport lookup fails. */ }
    }));
    return () => { cancelled = true; };
  }, [flight, backendUrl, headers]);
  const detailAirportLocation = (flight: Flight, side: 'departure' | 'arrival') => {
    const code = String(flight[`${side}_airport_code`] || '').trim().toUpperCase();
    const location = String(flight[`${side}_location`] || '').trim();
    if (!isFlightTransfer(flight)) return transferLocationLabel(location || code, lodgings,
      side === 'departure' ? flight.departure_date : flight.arrival_date || flight.departure_date, activities) || 'N/A';
    if (detailAirportLabels[code]) return detailAirportLabels[code];
    if (location && location.toUpperCase() !== code) {
      return code && !location.toUpperCase().includes(`(${code})`) ? `${location} (${code})` : location;
    }
    return code || location || 'N/A';
  };

  const ground = !isFlightTransfer(flight);
  return <TripItemDetailsDialog visible kind="flight" calendarEvent={uiTransferCalendarEvent(flight)}
    title={`${detailAirportLocation(flight, 'departure')} → ${detailAirportLocation(flight, 'arrival')}`}
    status={flight.status || undefined}
    rows={[...formatFlightDetails(flight).map(item => ({ label: item.label,
      value: item.label === 'Departure' ? detailAirportLocation(flight, 'departure')
        : item.label === 'Arrival' ? detailAirportLocation(flight, 'arrival') : item.value })),
      ...(canRateItem(flight.status) ? [{ label: 'Rating', value: null, content: <ItemRating status={flight.status} averageRating={flight.averageRating} ratingCount={flight.ratingCount} userStars={flight.userStars}
        readOnly={readOnly} onRate={onRate} name={`${detailAirportLocation(flight, 'departure')} to ${detailAirportLocation(flight, 'arrival')}`} testID={`transfer-rating-${flight.id}`} theme={theme} /> }] : [])]}
    supplementalContent={ground ? <TransferDirections lodgings={lodgings} departureDate={flight.departure_date} arrivalDate={flight.arrival_date || flight.departure_date} origin={flight.departure_location || flight.departure_airport_code || ''}
      destination={flight.arrival_location || flight.arrival_airport_code || ''}
      transferType={flight.transfer_type || flight.transferType || 'Other'} mapApp={mapApp} styles={styles} /> : undefined}
    styles={styles} theme={theme} readOnly={readOnly} onClose={onClose} onEdit={onEdit} onDelete={onDelete} testID={testID} />;
}

export function FlightDetailsDialog(props: Props) {
  return <TransferDetails {...props} />;
}
export function GroundTransferDetailsDialog(props: Props) {
  return <TransferDetails {...props} />;
}

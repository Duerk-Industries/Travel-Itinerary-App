import React, { useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { hotelsForTransferDate, type TransferHotel } from '../utils/transferHotels';
import { toWebStyle } from '../utils/webStyle';

export default function HotelAddressPicker({ hotels, date, onSelect, styles, testID }: {
  hotels: TransferHotel[]; date: string; onSelect: (address: string) => void; styles: Record<string, any>; testID: string;
}) {
  const [open, setOpen] = useState(false);
  // The owner supplies the trip's cached hotel list; typing in the form or opening
  // this dropdown should neither refetch hotels nor repeat the date filtering.
  const options = useMemo(() => hotelsForTransferDate(hotels, date), [hotels, date]);
  const disabled = options.length === 0;
  const label = disabled ? 'No hotels available' : 'Use hotel address';
  if (Platform.OS === 'web') return <select data-testid={testID} aria-label="Use hotel address" disabled={disabled} value=""
    onChange={event => { const hotel = options.find(item => item.id === event.target.value); if (hotel) onSelect(hotel.address.trim()); }}
    style={toWebStyle(styles.input, { width: 180, opacity: disabled ? 0.45 : 1 })}>
    <option value="">{label}</option>
    {options.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name} · {hotel.address}</option>)}
  </select>;
  return <View style={{ width: 180 }}>
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel="Use hotel address" disabled={disabled}
      accessibilityState={{ disabled, expanded: open && !disabled }} onPress={() => setOpen(value => !value)}
      style={[styles.input, { minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }]}>
      <Text style={styles.cellText}>{label} ▾</Text>
    </TouchableOpacity>
    {open && !disabled && options.map(hotel => <TouchableOpacity key={hotel.id} testID={`${testID}-${hotel.id}`} accessibilityRole="button"
      onPress={() => { onSelect(hotel.address.trim()); setOpen(false); }} style={[styles.input, { minHeight: 44 }]}>
      <Text style={styles.cellText}>{hotel.name} · {hotel.address}</Text>
    </TouchableOpacity>)}
  </View>;
}

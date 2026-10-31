import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { hotelsForTransferDate, activitiesForTransferDate, type TransferActivity, type TransferHotel } from '../utils/transferHotels';
import { toWebStyle } from '../utils/webStyle';

const CUSTOM_OPTION = 'custom';

export default function HotelAddressPicker({ hotels, activities = [], date, onSelect, onCustom, styles, testID }: {
  activities?: TransferActivity[]; hotels: TransferHotel[]; date: string; onSelect: (address: string) => void;
  /** Listed first: the traveler wants to type their own location, so hand them the text field. */
  onCustom?: () => void; styles: Record<string, any>; testID: string;
}) {
  const _styleTheme = useStyleTheme();
  const [open, setOpen] = useState(false);
  // The owner supplies the trip's cached hotel list; typing in the form or opening
  // this dropdown should neither refetch hotels nor repeat the date filtering.
  const options = useMemo(() => [
    ...hotelsForTransferDate(hotels, date),
    ...activitiesForTransferDate(activities, date).map(activity => ({ id: `activity:${activity.id}`, name: activity.name, address: activity.startLocation })),
  ], [hotels, activities, date]);
  const disabled = options.length === 0;
  const actionLabel = activities.length ? 'Use hotel or activity address' : 'Use hotel address';
  const label = disabled ? 'No locations available' : actionLabel;
  if (Platform.OS === 'web') return <select data-testid={testID} aria-label={actionLabel} disabled={disabled} value=""
    onChange={event => {
      if (event.target.value === CUSTOM_OPTION) { onCustom?.(); return; }
      const hotel = options.find(item => item.id === event.target.value); if (hotel) onSelect(hotel.address.trim());
    }}
    style={toWebStyle(styles.input, themeStyle('components_HotelAddressPicker_1', { disabled: disabled }, _styleTheme))}>
    <option value="">{label}</option>
    {onCustom ? <option value={CUSTOM_OPTION}>Custom location</option> : null}
    {options.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
  </select>;
  return <View style={themeStyle('components_HotelAddressPicker_2', {  }, _styleTheme)}>
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={actionLabel} disabled={disabled}
      accessibilityState={{ disabled, expanded: open && !disabled }} onPress={() => setOpen(value => !value)}
      style={[styles.input, themeStyle('components_HotelAddressPicker_3', { disabled: disabled }, _styleTheme)]}>
      <Text style={styles.cellText}>{label} ▾</Text>
    </TouchableOpacity>
    {open && !disabled && onCustom ? <TouchableOpacity testID={`${testID}-custom`} accessibilityRole="button"
      onPress={() => { setOpen(false); onCustom(); }} style={[styles.input, themeStyle('components_HotelAddressPicker_4', {  }, _styleTheme)]}>
      <Text style={styles.cellText}>Custom location</Text>
    </TouchableOpacity> : null}
    {open && !disabled && options.map(hotel => <TouchableOpacity key={hotel.id} testID={`${testID}-${hotel.id}`} accessibilityRole="button"
      onPress={() => { onSelect(hotel.address.trim()); setOpen(false); }} style={[styles.input, themeStyle('components_HotelAddressPicker_4', {  }, _styleTheme)]}>
      <Text style={styles.cellText}>{hotel.name}</Text>
    </TouchableOpacity>)}
  </View>;
}

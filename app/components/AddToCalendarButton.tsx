import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useContext, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { CalendarPreferenceContext } from '../contexts/CalendarPreferenceContext';
import type { CalendarEvent } from '../utils/calendarEvents';
import { openCalendar } from '../utils/openCalendar';

export default function AddToCalendarButton({ event, styles }: { event: CalendarEvent | null; styles: Record<string, any> }) {
  const _styleTheme = useStyleTheme();
  const preference = useContext(CalendarPreferenceContext);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!event) return null;
  return <View style={themeStyle('components_AddToCalendarButton_1', {  }, _styleTheme)}>
    <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel="Add to calendar"
      disabled={busy} onPress={async () => {
        setError(null); setBusy(true);
        try { await openCalendar(event, preference); }
        catch { setError('Unable to open calendar. Please try again.'); }
        finally { setBusy(false); }
      }}><Text style={styles.buttonText}>{busy ? 'Opening calendar…' : 'Add to calendar'}</Text></TouchableOpacity>
    {error ? <Text accessibilityRole="alert" style={styles.helperText}>{error}</Text> : null}
  </View>;
}

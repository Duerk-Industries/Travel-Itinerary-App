import React, { useContext, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { CalendarPreferenceContext } from '../contexts/CalendarPreferenceContext';
import type { CalendarEvent } from '../utils/calendarEvents';
import { openCalendar } from '../utils/openCalendar';

export default function AddToCalendarButton({ event, styles }: { event: CalendarEvent | null; styles: Record<string, any> }) {
  const preference = useContext(CalendarPreferenceContext);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!event) return null;
  return <View style={{ flexShrink: 1 }}>
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

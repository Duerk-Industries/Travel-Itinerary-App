import { Linking, Platform } from 'react-native';
import { buildCalendarIcs, buildGoogleCalendarUrl, type CalendarApp, type CalendarEvent } from './calendarEvents';

export async function openCalendar(event: CalendarEvent, preference: CalendarApp): Promise<void> {
  if (preference === 'google') {
    await Linking.openURL(buildGoogleCalendarUrl(event));
    return;
  }
  if (Platform.OS !== 'web') {
    const Calendar = await import('expo-calendar');
    if (Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) < 17) {
      const permission = await Calendar.requestCalendarPermissionsAsync();
      if (!permission.granted) throw new Error('Calendar permission was not granted');
    }
    await Calendar.createEventInCalendarAsync({ title: event.title,
      startDate: new Date(event.allDay ? `${event.start}T00:00:00` : event.start),
      endDate: new Date(event.allDay ? `${event.end}T00:00:00` : event.end),
      allDay: event.allDay, location: event.location, notes: event.description });
    return;
  }
  const url = URL.createObjectURL(new Blob([buildCalendarIcs(event)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'wanderbunnies-event.ics';
  document.body.appendChild(link); link.click(); link.remove();
  // Give Safari time to consume the calendar file before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

# Add to calendar

In Account, choose Google Calendar or Apple Calendar beside the maps preference,
then select **Save Profile**. The preference is stored with the user's profile
in both Postgres and Firebase. Existing profiles default to Google Calendar.

**Add to calendar** appears in activity, transfer, and lodging details, on car
rental rows and their overview details, and beside timed itinerary day items.
Read-only trip viewers can also copy events to their own calendar. Items without
a valid date have no calendar action. Date-only bookings become all-day events.

Google Calendar opens a prefilled event in Google Calendar. Apple Calendar opens
the system event editor in the installed mobile app; on the web it downloads an
iCalendar `.ics` file for import. The user reviews and saves the event. Browser
and OS support for importing calendar files varies, particularly on phones.

These are event copies, not a calendar subscription. Trip edits and deletions do
not update saved events. Repeated additions can create duplicates. Timed events
preserve the recorded local time and ask the user to check the event's time zone;
the trip models do not currently carry per-location time zones for transfers.
An unknown end time defaults to one hour, which the user can change in the editor.
Lodging checkout and rental dropoff dates are exclusive all-day end dates.

The `expo-calendar` dependency and shared Expo config plugin require a new native
build. iOS 17 and later use the event editor without requesting calendar access;
older iOS versions request the permission required by Expo's event editor.
The Postgres migration adds the nullable `web_users.calendar_preference` column.

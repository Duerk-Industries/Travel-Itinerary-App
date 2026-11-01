# Matching itinerary activities to GetYourGuide tours

Until there is Partner API access, tours are matched by hand and kept in
`server/data/getyourguide-tours.json`. The server syncs that file into the `getyourguide_tours`
table at startup, and a tour removed from the file is removed from the table. Do this as part of
writing a template, after the template validates.

## Add a tour

For each activity worth booking in the template:

1. Web-search GetYourGuide for that activity. Do not fetch getyourguide.com pages directly: the
   site refuses them. Do not work around that.
2. Keep only a tour page: its address looks like `/rio-de-janeiro-l9/some-tour-name-t770155/`.
   Drop `visitor-id`, `partner_id` and every other query value, and any locale prefix like `/en-gb/`.
   The partner ID is added when a traveler follows the link.
3. Use a rating and review count only when they clearly belong to that exact tour. A page for a
   whole attraction or city shows a total for many tours, so it does not count. When snapshots
   differ, use the one with the most reviews.
4. Skip a tour under 4.0 stars or with fewer than 50 reviews.
5. Check that the tour really does what the activity says, from where the traveler is that day. A
   day trip leaving Tokyo does not fit a template based somewhere else. No link beats a wrong link.
6. Add the tour, with `activities` holding the template's activity names, copied exactly. List every
   activity a combined tour covers.

```json
{
  "id": "t770155",
  "url": "https://www.getyourguide.com/rio-de-janeiro-l9/rio-de-janeiro-christ-the-redeemer-and-sugarloaf-tour-with-t770155/",
  "title": "Rio de Janeiro: Christ the Redeemer and Sugarloaf Tour with Lunch",
  "rating": 4.6,
  "reviewCount": 455,
  "city": "Rio de Janeiro",
  "country": "Brazil",
  "activities": ["Christ the Redeemer", "Sugarloaf Mountain cable car"],
  "checkedAt": "2026-10-31"
}
```

Keep several tours for one activity when they differ, such as a ticket and a combined tour.

## Running it over many templates

Only activities whose `book` note is set are worth a search, about 300 distinct names across all
bundles. Work the list in batches.

- **Search budget.** Web searches are capped per turn (200), and every agent running in that turn
  shares the cap. Aim for about one search per activity, so one turn covers roughly 150 activities.
  Several parallel agents just drain the same cap faster; split the list so each agent has about
  40 activities and expect to continue in the next turn.
- **Keep a record.** Give each agent a work list file and have it write two files: the tours it found,
  and a `searched` list of every activity name it actually searched, whether or not it found a tour.
  Without the second, a later run cannot tell "searched, nothing suitable" from "never searched".
- **Search tips.** Restrict the search to the getyourguide.com domain. A query holding the tour's
  `t` number returns that tour's own rating and review count, which settles step 3 above. Prefer the
  figures from the result that names the exact tour.
- **Merge.** Write results to a scratch JSON array, not straight into `getyourguide-tours.json`, then
  merge with `python server/tools/trip-templates/merge_gyg_tours.py <tours.json>...`. It rejects an
  entry with a malformed URL, a tour id that is not in the URL, a rating under 4.0, fewer than 50
  reviews, an activity name no template has, or an id already in the file, and prints why.
- **Check.** Run `npx jest --config jest.projects.js --runInBand getYourGuide` from `server/`.
- **Read the doubts.** Have agents list matches they were unsure of (a rating tied to a tour only by
  title, a tour covering only one stop of a combined activity, a different departure city) and check
  those before committing. No link beats a wrong link.

## How a tour is chosen

The choice is made per trip, in `selectToursForActivities`, so it needs no template-specific data.

- The activity's name must match exactly, ignoring only case and accents, and the activity or the
  trip must mention the tour's `city` or `country`. This also covers existing and AI-generated trips.
- Only `Proposed` and `Needs Booking` activities get a link.
- A tour covering other stops the same day comes first, then one covering other stops anywhere on
  the trip, then the highest rating × log(number of ratings).

Both stops of a combined tour show the same link. Booking through one does not change the other's status.

## Where a link shows

On "What to book now" for `Needs Booking` activities, and at the bottom of the activity edit dialog.

# Reactions On Itinerary Detail Rows

## What can be reacted to?

- Per-day itinerary detail rows (rows under "Day N" inside a generated or manually
  curated itinerary). The data model is `ItineraryDetail`.

This is separate from the existing voting system on transfers, lodgings, activities,
and car rentals — see `voting-on-items.md` for that. Itinerary-detail reactions live
in their own table (`itinerary_detail_reactions`) and have their own routes.

## How reactions behave

- Each row shows a 👍 + score + 👎 control under the activity text.
- Clicking 👍 records `value = 1`. Clicking 👎 records `value = -1`. Clicking the
  same one again clears your vote.
- Each user can have at most one vote per detail. The score is `upCount − downCount`.
- The control updates optimistically; the server response replaces the optimistic
  state. If the network call fails, the local state rolls back.

## Authorization rules

- Reading reaction summaries is open to any trip member or follower.
- Writing reactions (POST or DELETE) requires full trip membership. Followers cannot
  react. This matches the existing item-vote permission model.

## Feature flag

- Gated behind `itinerary_reactions`. Default is `enabled: true`.
- When disabled, the write routes return `403 { code: "FEATURE_DISABLED" }` and the
  UI hides the control. The `GET` route continues to return summaries so historical
  data remains visible.

## API endpoints

- `GET /api/itineraries/details/:detailId/reactions` — returns `{ score, upCount,
  downCount, userValue }`.
- `POST /api/itineraries/details/:detailId/reactions` — body `{ value: 1 | -1 }`.
  Upserts the user's vote. Returns the updated summary.
- `DELETE /api/itineraries/details/:detailId/reactions` — clears the user's vote.
  Returns the updated summary.

The list endpoint `GET /api/itineraries/:id/details` inlines the same summary on
every row in its response — no follow-up fetch is required to render the reaction
bar on a freshly loaded itinerary.

Response shape:

```json
{ "score": 1, "upCount": 1, "downCount": 0, "userValue": 1 }
```

`userValue` is `1`, `-1`, or `null`.

## Future evolution

A multi-emoji extension (heart, smile, etc.) is scoped in
`docs/implementation-plan-itinerary-collab.md` §3 but deferred. Such an extension
would drop the `UNIQUE (detail_id, user_id)` constraint and add an `emoji` column
with `UNIQUE (detail_id, user_id, emoji)`.

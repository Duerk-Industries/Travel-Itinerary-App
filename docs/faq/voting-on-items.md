# Voting On Itinerary Items

## What can be voted on?

- Transfers
- Lodging
- Activities
- Car Rentals

## How voting behaves

- A `Votes` and `Rating` column are shown immediately after `Status` on each page.
- If status is `Proposed` and the current user has not voted yet, `👍` and `👎` buttons are shown.
- If status is anything else, or the user already voted, the cell shows net votes.
- If status is `Completed` and the current user has not rated yet, `👍` and `👎` buttons are shown in `Rating`.
- If status is `Completed` and the user already rated, `Rating` shows net rating.
- For non-`Completed` statuses, `Rating` is not actionable.

## Authorization rules

- Only full trip members can vote.
- Followers can view trip items but cannot vote.

## API endpoints

- `POST /api/transfers/:id/vote`
- `POST /api/lodgings/:id/vote`
- `POST /api/activities/:id/vote`
- `POST /api/car-rentals/:id/vote`
- `POST /api/transfers/:id/rating`
- `POST /api/lodgings/:id/rating`
- `POST /api/activities/:id/rating`
- `POST /api/car-rentals/:id/rating`

Request body:

```json
{ "value": 1 }
```

`value` must be `1` (thumbs up) or `-1` (thumbs down).


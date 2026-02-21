# Voting On Itinerary Items

## What can be voted on?

- Flights
- Lodging
- Tours
- Car Rentals

## How voting behaves

- A `Votes` column is shown immediately after `Status` on each page.
- If status is `Proposed` and the current user has not voted yet, `👍` and `👎` buttons are shown.
- If status is anything else, or the user already voted, the cell shows net votes.

## Authorization rules

- Only full trip members can vote.
- Followers can view trip items but cannot vote.

## API endpoints

- `POST /api/flights/:id/vote`
- `POST /api/lodgings/:id/vote`
- `POST /api/tours/:id/vote`
- `POST /api/car-rentals/:id/vote`

Request body:

```json
{ "value": 1 }
```

`value` must be `1` (thumbs up) or `-1` (thumbs down).

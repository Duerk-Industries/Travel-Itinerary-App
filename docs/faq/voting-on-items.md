# Rating Itinerary Items

## What can be rated?

- Transfers
- Lodging
- Activities
- Car Rentals

## How voting behaves

- Travelers rate an item from 1 to 5 whole stars once its status is `Completed`. Before that, `Rating` shows `-`.
- A `Rating` column follows `Status` on each page, and the item's details show the same control.
- `Rating` shows the stars the current user gave and the group's average with the number of travelers who rated, for example `4.5 (2)`.
- A traveler can change their rating at any time by tapping a different star.
- Proposal voting is retired: `POST /:id/vote` returns `410`.

## Authorization rules

- Only full trip members can rate.
- Followers can see the average but cannot rate.

## API endpoints

- `POST /api/transfers/:id/rating`
- `POST /api/lodgings/:id/rating`
- `POST /api/activities/:id/rating`
- `POST /api/car-rentals/:id/rating`

Request body:

```json
{ "stars": 4 }
```

`stars` must be a whole number from 1 to 5.

## Earlier thumbs ratings

Thumbs were the rating system before stars. They stay in `item_votes` and count as 5 stars (up) or 1 star (down) until the traveler rates again, which replaces their thumb. Stars live in `item_ratings`.

Builds released before stars send `{ "value": 1 }` or `{ "value": -1 }`, saved as 5 or 1 stars. They also read `netRating` and `userRating`, which the API still returns: 3 stars or more counts as up. Do not remove either until those builds are gone.


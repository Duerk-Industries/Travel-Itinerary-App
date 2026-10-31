# Rating Itinerary Items

## What can be rated?

- Transfers
- Lodging
- Activities
- Car Rentals

## How voting behaves

- Travelers rate an item from 1 to 5 whole stars once its status is `Completed`. Before that, `Rating` shows `-`.
- A `Rating` column follows `Status` on each page, and the item's details show the same control.
- `Rating` shows the group's average with the number of ratings it is over, for example `4.5 (2)`, and empty stars to tap. Once the current user has rated, their own stars show in place of the average.
- The average covers every traveler's rating of the same provider, not only this item: the same hotel (by name and address, else name and trip destination), airline, rental company or activity.
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

## Where ratings are stored

Stars live in `item_star_ratings` (one row per traveler per item, with the provider they are averaged under). Stars saved per item in the earlier `item_ratings` table are moved there at startup.

## Earlier thumbs ratings

Thumbs were the rating system before stars. At startup each thumb in `item_votes` becomes a star rating (up is 5 stars, down is 1) and is then removed; a traveler who has already used stars keeps them.

Builds released before stars send `{ "value": 1 }` or `{ "value": -1 }`, saved as 5 or 1 stars. They also read `netRating` and `userRating`, which the API still returns: 3 stars or more counts as up. Do not remove either until those builds are gone.

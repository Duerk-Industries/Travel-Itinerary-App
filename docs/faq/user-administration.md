# User Administration FAQ

## What user admin actions are available in product?

Under `/api/account`:

- View profile
- Update name/email
- Change/set password
- Delete account

## What relationship management is implemented?

- Fellow travelers CRUD (`/api/account/fellow-travelers`)
- Family relationship create/accept/reject/update/delete (`/api/account/family*`)

## What group/member administration exists?

- Group list/create/delete
- Add/remove members (registered users or guests)
- Invite list/accept/reject/cancel
- Trip-level member add/remove routes under `/api/account/trips/:tripId/members`

## What happens on account deletion?

- Related data is cleaned up.
- In-memory mode includes explicit transactional cleanup/reassignment logic.
- Other providers use DB-adapter cleanup (`deleteWebUserAndCleanup`).

## Are there admin/ops scripts for users/trips?

- `npm run list-users`
- `npm run list-trips`
- `npm run accounts:seed` (local-guarded; requires `ALLOW_TEST_ACCOUNT_SEED=1`)


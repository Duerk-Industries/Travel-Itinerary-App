# Auth Phase 1: Username + Multi-Email Foundation

Phase 1 adds persisted auth flags and schema groundwork without forcing a login UX cutover.

## Persisted config

- File: `server/config/auth-flags.yaml`
- Loader: `server/src/config/authFlags.ts`
- Optional env override: `AUTH_FLAGS_CONFIG_PATH`

Current flags:

- `usernameLoginEnabled`
- `multiEmailEnabled`
- `appleOAuthEnabled`
- `googleAutoLinkEnabled`
- `enforceVerifiedEmailInvariant`
- `uiProviderButtonsEnabled`

## Data model changes

- `users`
  - `username`
  - `username_normalized` (unique)
- `user_emails`
  - one-to-many email mapping per user
  - globally unique normalized email (`email_normalized`)
  - `is_primary`, `is_verified`, `verified_at`

## Username rules (phase 1)

- case-insensitive (stored normalized lower-case)
- allowed chars: `[a-z0-9_-]`
- max length: 30
- collisions resolved with numeric suffix (for example `samename2`)
- reserved names come from `auth-flags.yaml`

## Backfill behavior

On `initDb()`:

- users missing usernames are assigned generated unique usernames
- existing user primary email is mirrored into `user_emails`

## Seed updates

- `scripts/create-test-accounts.ts` now expects `username` in input JSON
- `test_inputs/default_accounts.json` now includes usernames based on `firstname+lastname` lower-case

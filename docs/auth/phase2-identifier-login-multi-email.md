# Auth Phase 2: Identifier Login + Account Email Management

Phase 2 builds on Phase 1 by enabling username login and user-managed multi-email behavior behind feature flags.

## Feature flags

Configured in `server/config/auth-flags.yaml`:

- `usernameLoginEnabled`
- `multiEmailEnabled`

Both default to `false` in the checked-in config.

## Login payload

`POST /api/web-auth/login` now accepts:

- `identifier`: email or username
- `password`

Backward compatibility:

- `email` is still accepted as an alias for `identifier`.

If `usernameLoginEnabled` is `false`, non-email identifiers are rejected.

## Secondary email verification flow

Added callback endpoint:

- `GET /api/web-auth/confirm-email?token=...`

Used for verifying added secondary emails.

## Account email management endpoints

All below require auth and only operate when `multiEmailEnabled` is `true`.

- `GET /api/account/emails`
  - returns linked emails with `isPrimary` and `isVerified`
- `POST /api/account/emails`
  - body: `{ "email": "..." }`
  - adds a secondary email and sends verification email
- `POST /api/account/emails/:email/resend-verification`
  - issues a new verification link
- `PATCH /api/account/emails/primary`
  - body: `{ "email": "..." }`
  - requires linked+verified email
- `DELETE /api/account/emails/:email`
  - only non-primary
  - blocked if it would violate "at least one verified email remains"

## Data model additions

Postgres adds:

- `user_email_verifications`
  - per-email verification token lifecycle for secondary emails

## App changes

- Login form field text updated to `Email or Username`.
- Login sends `identifier` to backend.
- Account section now includes linked email management UI:
  - add secondary email
  - resend verification
  - make verified email primary
  - delete non-primary email
- If `/api/account/emails` returns `404`, the email manager UI remains hidden (for disabled phase flag or non-supporting backend).

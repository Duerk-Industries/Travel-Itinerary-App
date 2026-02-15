# Authentication and Access FAQ

## What auth methods are supported?

- Email/password register/login (`/api/auth/*` and `/api/web-auth/*`)
- OAuth Google login (`/api/auth/google` + callback)
- Bearer JWT auth for protected APIs

## How long do auth tokens last?

- JWTs are signed for `7d` in `server/src/auth.ts`.

## Is email verification required?

- Yes for email/password registration.
- Unverified users cannot log in.
- Expired confirmation tokens can trigger account deletion of unverified users (`410` flow).

## Is password setup required for some OAuth users?

- Yes. Some OAuth-created users must set a password.
- While required, most endpoints return `403`.
- Allowed while blocked: password setup endpoint and group invite endpoints needed for onboarding.


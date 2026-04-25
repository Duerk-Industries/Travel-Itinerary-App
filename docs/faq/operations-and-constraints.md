# Operations and Constraints FAQ

## What data providers are supported?

- `postgres`, `memory`, `firebase`, `dynamodb` (dynamodb is scaffolded and not implemented).

## What is the default provider selection behavior?

- Local default: `postgres`
- Cloud-run-like environments: `firebase`
- `USE_IN_MEMORY_DB=1` forces memory

## What notable runtime constraints should be known?

- CORS is strict: localhost patterns in local mode, otherwise `BACKEND_URL` (with `WEB_URL` still accepted as a compatibility fallback).
- If `server/public/index.html` is missing, `/` falls back to login page handling.
- Web-auth routes are exposed via both `/api/auth/*` and `/api/web-auth/*` for compatibility.

## How should API limits be set in operations?

- Configure in `server/config/api-limits.yaml`.
- Optionally set `API_LIMITS_CONFIG_PATH` to point to a different YAML file per environment.
- Use both an overall provider cap and caller caps where you want isolation.
- Start from `server/config/api-limits.yaml` and tune per environment.

Recommended practice:

- Keep each provider `overall` aligned with your provider quota.
- Set noisy caller caps under `callers` lower than overall.
- Monitor server logs for 50/75/90/100% threshold events.

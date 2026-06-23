# Key Exposure Audit and Rotation Guide

## Exposed values found in tracked files

1. `app.json` (previously)
   - Key: `expo.extra.firebaseApiKey`
   - Status: removed from `app.json`; app now reads Firebase/App Check config from env files.

## Where sensitive values must live

1. `app/.env` or `app/.local_env`
   - `EXPO_PUBLIC_BACKEND_URL`
   - `EXPO_PUBLIC_FIREBASE_API_KEY`
   - `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
   - `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `EXPO_PUBLIC_FIREBASE_APP_ID`
   - `EXPO_PUBLIC_RECAPTCHA_SITE_KEY`
2. `server/.env`
   - Primary local source for both regular server env vars and secrets.
   - `AUTH_SECRET`
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `UNSPLASH_ACCESS_KEY`
   - `SMTP_USER`, `SMTP_PASS`
   - `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
3. `server/.secrets` (optional fallback / backwards compatibility)
   - Still supported by loaders and deploy scripts, but no longer the primary local source.
   - You can keep it empty or use it as a fallback during migration.
   - For Cloud Run, adding `AUTH_SECRET=AUTH_SECRET` here is the preferred Secret Manager mapping pattern when you do not want to upload the raw value from `server/.env`.

## Rotation/update steps

1. Firebase web/app-check config
   - In Firebase Console, regenerate any compromised web/App Check keys if needed.
   - Update values in `app/.env` (or `app/.local_env` for local-only overrides).
   - Rebuild/redeploy client.
2. OpenAI key
   - Create a new key in OpenAI dashboard.
   - Replace `OPENAI_API_KEY` in `server/.env`.
   - Revoke old key, then restart/redeploy server.
3. Unsplash key
   - Regenerate/reissue in Unsplash developer settings.
   - Update `UNSPLASH_ACCESS_KEY` in `server/.env`.
   - Restart/redeploy server.
4. SMTP credentials
   - Rotate SMTP password/app password at your email provider.
   - Update `SMTP_USER`/`SMTP_PASS` in `server/.env`.
   - Restart/redeploy server.
5. JWT/Auth secret
   - Generate a new random value for `AUTH_SECRET`.
   - Update in `server/.env`.
   - Restart/redeploy server.

## Git safety checks

1. Ensure `.env`, `.local_env`, `.secrets`, `.secret` are ignored in all workspaces.
2. Never commit service-account JSON keys; use env/secret manager values instead.
3. Before commit, run a quick scan:
   - `git grep -n "AIza\\|sk-\\|BEGIN PRIVATE KEY\\|OPENAI_API_KEY\\|SMTP_PASS\\|AUTH_SECRET"`

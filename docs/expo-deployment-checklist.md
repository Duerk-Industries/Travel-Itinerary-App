# Expo Deployment Checklist

Covers iOS native (EAS Build → App Store), Android native (EAS Build → Play Store), and web (`expo export` → server).

---

## Prerequisites

- EAS CLI installed and authenticated:
  ```bash
  npm install -g eas-cli
  eas login          # logs into Expo account (duerk-industries)
  eas whoami         # confirm: duerk-industries
  ```
- Apple Developer account access (for iOS signing / TestFlight).
- Google Play Console access (for Android).
- All tests passing locally before triggering a remote build.

---

## 1. Verify tests and types pass

```bash
# From repo root
cd app && npm test
cd server && npm test
cd app && npm run typecheck
```

Fix any failures before proceeding.

---

## 2. EAS secrets — one-time setup

These are stored in the EAS project and injected at build time. Set them once; they persist across builds.

### Required for Sentry source-map upload (native + web)

```bash
cd app
npx --yes eas-cli@20.2.0 secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
npx --yes eas-cli@20.2.0 secret:create --scope project --name SENTRY_ORG       --value duerk-industries
npx --yes eas-cli@20.2.0 secret:create --scope project --name SENTRY_PROJECT   --value wanderbunnies-app
```

Without `SENTRY_AUTH_TOKEN`, runtime crash reporting still works but stack traces are unsymbolicated.

### Required for Firebase native auth (iOS / Android)

```bash
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_API_KEY             --value <key>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN         --value <domain>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_PROJECT_ID          --value <project-id>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET      --value <bucket>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value <sender-id>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_FIREBASE_APP_ID             --value <app-id>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_RECAPTCHA_SITE_KEY           --value <site-key>
```

### Optional — Google Maps / Places (if map features are enabled in the build)

```bash
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY   --value <key>
npx --yes eas-cli@20.2.0 secret:create --scope project --name EXPO_PUBLIC_GOOGLE_PLACES_API_KEY --value <key>
```

### Verify all secrets are present

```bash
npx --yes eas-cli@20.2.0 secret:list
```

---

## 3. Variables already baked into `eas.json` (no action needed)

These are hardcoded in [app/eas.json](../app/eas.json) for both `preview` and `production` profiles and do not need to be set manually:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | `https://duerk.org` |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry ingest URL |
| `SENTRY_ALLOW_FAILURE` | `true` |

To change the backend URL for a build, edit `eas.json` before triggering the build.

---

## 4. Clear caches before building

### Metro / Expo local cache

```bash
cd app
npx expo start --clear   # clears Metro transformer cache
```

Or just delete the cache directory:

```bash
rm -rf app/.expo
rm -rf app/node_modules/.cache
```

### npm cache (if dependency issues are suspected)

```bash
npm cache clean --force --prefix app
npm install --prefix app
```

### EAS remote build cache

Pass `--clear-cache` to force EAS to ignore its incremental build cache:

```bash
npx --yes eas-cli@20.2.0 build --platform ios --profile production --clear-cache
```

---

## 5. iOS build and submit

### Build

```bash
cd app
npm run build:ios
# equivalent to: eas build --platform ios --profile production
```

`autoIncrement: true` in `eas.json` bumps the build number automatically on EAS.

Monitor the build at [expo.dev](https://expo.dev) or stream logs:

```bash
npx --yes eas-cli@20.2.0 build:list --platform ios --limit 1
```

#### Local iOS build (optional, requires Mac + Xcode)

```bash
npm run build:ios:local
```

### Submit to App Store

After the build completes:

```bash
cd app
npm run submit:ios
# equivalent to: eas submit --platform ios --profile production
```

This uploads the `.ipa` to App Store Connect / TestFlight. Ensure you have an app record created in App Store Connect for bundle ID `com.duerkindustries.travelitineraryplanner`.

---

## 6. Android build and submit

### Build

```bash
cd app
npx --yes eas-cli@20.2.0 build --platform android --profile production
```

### Submit to Play Store

```bash
npx --yes eas-cli@20.2.0 submit --platform android --profile production
```

Requires a Google Play service account JSON key configured in EAS:

```bash
npx --yes eas-cli@20.2.0 secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY --value "$(cat /path/to/key.json)"
```

---

## 7. Web build and deploy

The web export goes into `app/dist/`, which is then copied to `server/public/` so the Express server can serve it as a SPA.

### Export

```bash
# With Sentry source-map upload:
SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=duerk-industries SENTRY_PROJECT=wanderbunnies-app \
  EXPO_PUBLIC_SENTRY_DSN=<dsn> \
  npm --prefix app run export:web

# Without Sentry (source maps skipped, runtime reporting still works if DSN is set):
npm --prefix app run export:web
```

Output lands in `app/dist/`.

### Copy to server and deploy

```bash
cp -r app/dist/* server/public/
```

Then deploy the server (Cloud Run, Docker, etc.) — the SPA is served from `server/public/` at the `/` route.

---

## 8. Post-deploy verification checklist

- [ ] Open the app (web or device) and complete a full login flow.
- [ ] Create a test trip to confirm backend connectivity to `https://duerk.org`.
- [ ] Check Sentry project for any new error spikes after rollout.
- [ ] Confirm build number incremented correctly in the App Store / Play Console.
- [ ] Smoke-test any features changed in this release.

---

## Key identifiers

| Item | Value |
|---|---|
| EAS owner | `duerk-industries` |
| EAS project ID | `06966c0b-d878-4346-850c-090c762f1916` |
| iOS bundle identifier | `com.duerkindustries.travelitineraryplanner` |
| Android package | `com.duerkindustries.travelitineraryplanner` |
| Expo slug | `travel-itinerary-planner` |
| Production backend | `https://duerk.org` |
| EAS CLI version pinned to | `20.2.0` |

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

## 0. One-time Apple Developer / App Store Connect setup

These are account- and listing-level prerequisites that live outside EAS and
outside this repo. A build can succeed and still be un-submittable (or
rejected) if any of these are missing. Re-check this section whenever Apple
Developer Program membership renews (annually) or before the *first*
submission of a new app record.

- **Program agreements / banking / tax.** In App Store Connect → Agreements,
  Tax, and Banking, ensure the current Paid Apps Agreement (and any other
  required agreement) is active. Apple blocks *all* releases — including free
  apps — while an agreement is unsigned.
- **App ID capability: Sign in with Apple.** The app ships `AppleSignInButton`
  ([app/components/AppleSignInButton.tsx](../app/components/AppleSignInButton.tsx))
  alongside other social login. Apple Guideline 4.8 requires native Sign in
  with Apple whenever another third-party/social login is offered. Confirm in
  the Apple Developer portal that the **Sign In with Apple** capability is
  enabled for App ID `com.duerkindustries.travelitineraryplanner` and included
  in the provisioning profile used for the production build — a missing
  capability here is a common App Review rejection reason, not something EAS
  will catch for you.
  > **Known failure mode:** if `ios.usesAppleSignIn` isn't set in the Expo
  > config, `eas build` tries to *disable* the `APPLE_ID_AUTH` capability on
  > the bundle ID during its automatic capability sync and Apple's API
  > rejects it with a misleading error (`Failed to patch capabilities` /
  > `The bundle '<id>' cannot be deleted. Delete all the Apps related to
  > this bundle to proceed.`). `usesAppleSignIn: true` alone is **not**
  > enough to fix this — without the `expo-apple-authentication` package
  > installed, that config field is a silent no-op (Expo's fallback plugin
  > just emits a build warning telling you to install it; it never adds the
  > entitlement). Both of these are required together:
  > - `usesAppleSignIn: true` under `ios` in
  >   [expo.config.shared.cjs](../expo.config.shared.cjs)
  > - `expo-apple-authentication` installed in `app/package.json` (the real
  >   config plugin that reads the flag above and adds the
  >   `com.apple.developer.applesignin` entitlement) — install with
  >   `npx expo install expo-apple-authentication` from `app/` so it pulls
  >   the SDK-matched version.
  >
  > Verify the fix locally before rebuilding:
  > ```bash
  > cd app && npx expo config --type public --json | grep usesAppleSignIn
  > ```
  > If it recurs anyway, `EXPO_NO_CAPABILITY_SYNC=1` skips auto-sync entirely
  > (capability must then be managed by hand in the Apple Developer portal).
- **iOS signing credentials.** Verify a valid distribution certificate and
  production provisioning profile are on file in EAS (they expire annually and
  a build can succeed locally against a cached credential that's actually
  stale):
  ```bash
  cd app
  npx --yes eas-cli@20.2.0 credentials
  # iOS → production → check certificate / profile expiry
  ```
- **App Store Connect submit credentials.** `app/eas.json`'s `submit.production`
  profile is currently empty (`{}`), so `eas submit --platform ios` falls back
  to interactive Apple ID login (with 2FA) at submit time. That's fine for a
  human running this checklist locally. For a non-interactive/CI submission,
  add an App Store Connect API key instead:
  ```bash
  npx --yes eas-cli@20.2.0 submit --platform ios --profile production
  # or configure once via:
  #   "submit": { "production": { "ios": {
  #     "ascApiKeyPath": "./AuthKey_XXXX.p8",
  #     "ascApiKeyId": "XXXX",
  #     "ascApiKeyIssuerId": "..."
  #   } } }
  ```
- **App Store Connect app record.** Create (or confirm) the app record for
  bundle ID `com.duerkindustries.travelitineraryplanner`, and fill in the
  listing metadata Apple requires before review can start: screenshots for
  each required device size, description, keywords, support URL, marketing
  URL, age rating, and the **App Privacy "nutrition label"** questionnaire
  (data collection/tracking disclosures). None of this is set by EAS — it's
  filled in directly in App Store Connect.
- **Privacy manifest (`PrivacyInfo.xcprivacy`).** Since mid-2024, Apple's
  App Store Connect static analysis rejects binaries where a bundled SDK uses
  a "required reason" API (e.g. UserDefaults, file timestamps, disk space)
  without declaring it in a privacy manifest. Firebase and other native SDKs
  in this app may pull in APIs that require one. After the first production
  build, check the EAS build logs / Xcode archive for any missing
  privacy-manifest warnings before submitting.
- **Marketing version bump.** `version` is hardcoded in
  [expo.config.shared.cjs](../expo.config.shared.cjs) (currently `0.1.0`) and
  is shared by both `app/app.config.ts` and the root config. `autoIncrement:
  true` in `eas.json` only bumps the **build number** automatically — the
  semantic/marketing version does not change on its own. Bump it by hand in
  `expo.config.shared.cjs` before any release that should show a new version
  string in the App Store.
- **Mixed CNG workflow — Android is bare, iOS is managed.** `app/android/` is
  committed to git (native project checked in) while `app/ios/` is not. `expo
  doctor` flags this as "app config fields that may not be synced in a
  non-CNG project": when a platform's native folder is present, `eas build`
  uses that checked-in project **as-is** and skips Prebuild for it, so
  changes to `scheme`, `icon`, `userInterfaceStyle`, `splash`, `android`, or
  `plugins` in `expo.config.shared.cjs` **do not apply to Android builds**
  until you regenerate and commit the native project:
  ```bash
  cd app
  npx expo prebuild --platform android --clean
  git add android/
  ```
  iOS has no committed native folder, so it still goes through Prebuild fresh
  on every `eas build` — config changes under `ios` (like `usesAppleSignIn`
  above) take effect there without any extra step. If Android ever needs the
  same `ios`-only config change (it doesn't for Sign in with Apple), don't
  assume editing `expo.config.shared.cjs` is enough — check whether the
  Android side needs the same manual prebuild-and-commit step.

---

## 1. Verify tests, types, and Expo config health

```bash
# From repo root
cd app && npm test
cd server && npm test
cd app && npm run typecheck
cd app && npx expo-doctor
```

`expo-doctor` catches config-sync problems (like the CNG mismatch above)
before they surface mid-build as a confusing EAS error. A failing check here
should be understood, not just re-run past — read the check's advice output
before proceeding.

Fix any failures before proceeding.

---

## 2. EAS secrets — one-time setup

These are stored in the EAS project and injected at build time. Set them once; they persist across builds.

> `eas secret:*` is deprecated in favor of `eas env:*`. The commands below use
> `eas env:create`, which ties each variable to one or more **environments**
> (`production`, `preview`, `development`) rather than being project-wide by
> default. The commands below only target `production`. If the `preview`
> build profile also needs these values (it shares the same Firebase/Sentry
> project), either rerun with `--environment preview` or pass
> `--environment production,preview` to create both at once.
>
> EAS also rejects `--visibility secret` for any `EXPO_PUBLIC_` variable —
> those get compiled into the client bundle in plain text, so a "secret"
> visibility would be misleading and EAS enforces `plaintext` or `sensitive`
> instead. Non-`EXPO_PUBLIC_` values (Sentry auth token, Google service
> account key) keep `secret` visibility below; `EXPO_PUBLIC_` values use
> `sensitive` (masked in logs, but still readable by anyone who decompiles
> the built app — same exposure as before).

### Required for Sentry source-map upload (native + web)

```bash
cd app
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility secret --name SENTRY_AUTH_TOKEN --value <token>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility secret --name SENTRY_ORG       --value duerk-industries
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility secret --name SENTRY_PROJECT   --value wanderbunnies-app
```

Without `SENTRY_AUTH_TOKEN`, runtime crash reporting still works but stack traces are unsymbolicated.

### Required for Firebase native auth (iOS / Android)

```bash
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_API_KEY             --value <key>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN         --value <domain>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_PROJECT_ID          --value <project-id>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET      --value <bucket>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value <sender-id>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_FIREBASE_APP_ID             --value <app-id>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_RECAPTCHA_SITE_KEY           --value <site-key>
```

### Optional — Google Maps / Places (if map features are enabled in the build)

Static map previews are served through the authenticated backend proxy so
Google quota and spend are enforced by the shared API limiter. Configure the
backend secret `GOOGLE_STATIC_MAPS_API_KEY` (or `GOOGLE_MAPS_API_KEY`) on
Cloud Run; an Expo-public key is only needed for any remaining native map SDK
integration.

```bash
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY   --value <key>
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility sensitive --name EXPO_PUBLIC_GOOGLE_PLACES_API_KEY --value <key>
```

### Verify all secrets are present

```bash
npx --yes eas-cli@20.2.0 env:list --scope project --environment production
```

---

## 3. Variables already baked into `eas.json` (no action needed)

These are hardcoded in [app/eas.json](../app/eas.json) for both `preview` and `production` profiles and do not need to be set manually:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | `https://wander-bunnies.com` |
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

> **Troubleshooting: `TypeError: fetch failed` on startup.** Every `expo
> start` (with or without `--clear`) does an online check against
> `api.expo.dev`/`exp.host` for native module version compatibility before
> Metro comes up. If that fetch fails — even when the same URL loads fine in
> a browser — it's usually Node's `fetch` (undici) hitting a proxy/VPN/IPv6
> path that the browser handles differently. Skip the check with:
> ```bash
> npx expo start --clear --offline
> ```

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

> Before running this section for the first time (or after an annual
> credential/agreement renewal), work through **[Section 0](#0-one-time-apple-developer--app-store-connect-setup)**
> — signing credentials, Sign in with Apple capability, and App Store Connect
> listing metadata all have to be in place or the build/submit below will
> either fail or sit stuck in review.

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
npx --yes eas-cli@20.2.0 env:create --scope project --environment production --visibility secret --name GOOGLE_SERVICE_ACCOUNT_KEY --type file --value /path/to/key.json
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
- [ ] Create a test trip to confirm backend connectivity to `https://wander-bunnies.com`.
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
| Production backend | `https://wander-bunnies.com` |
| EAS CLI version pinned to | `20.2.0` |

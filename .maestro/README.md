# Maestro E2E flows

[Maestro](https://maestro.dev) drives the actual installed app on a real
simulator/emulator/device. We use it to catch crashes that no unit test can —
specifically, transitive imports in `App.tsx` failing on Hermes (the class of
bug that caused our recent iOS launch failure).

## Why Maestro (not Detox)

- No native build configuration required — flows run against any installed
  build, including release builds produced by `eas build`.
- YAML flows, no Jest/Mocha runner to set up.
- Easy to add to CI later (a macOS runner with a simulator).

## Prerequisites

1. **Install the Maestro CLI** (one-time):
   - macOS / Linux: `curl -Ls "https://get.maestro.mobile.dev" | bash`
   - Windows: install [Scoop](https://scoop.sh) then `scoop install maestro`,
     or run inside WSL2.
2. **Have a target running**:
   - iOS Simulator (macOS only) booted with our app installed, OR
   - Android emulator running with our app installed, OR
   - A physical device connected with the app installed.
3. **Install the app**:
   - From a local build: `eas build --platform ios --profile preview --local`
     then drag the `.app` to the simulator, OR
   - From EAS: download the latest preview `.ipa` / `.apk` from the EAS
     dashboard and install it.

## Running the smoke tests

```sh
maestro test .maestro/launch-smoke.yaml
maestro test .maestro
```

Pass condition: the app launches, the startup failure screen is not visible,
and the auth form (`testID="auth-form"`) appears within 30 seconds.

## What this catches

The smoke flow is intentionally narrow but covers a high-value regression
class:

- Any top-level `import` in the `App.tsx` graph that throws on Hermes
  (Node-only deps, unsupported Intl APIs, etc.). The app's defensive
  wrapper in `app/AppEntry.js` would render the "WanderBunnies could not
  start" failure screen instead of the real UI — Maestro fails on its
  presence.
- Any regression that prevents the auth form from rendering at all
  (broken navigation, suspense fallback stuck forever, etc.).

The expanded smoke suite also checks backend-independent native behavior:

- `auth-form-native-smoke.yaml` verifies controlled inputs, keyboard text, and
  Login/Create mode switching in the installed native bundle.
- `deep-link-launch-smoke.yaml` verifies the registered native URL scheme can
  launch the installed app and still render the logged-out UI.

It deliberately does **not** exercise authenticated trip/navigation feature
flows yet — those belong in Playwright for web today, and in future Maestro
flows once we have a seeded native test backend and CI emulator infrastructure.

## Adding more flows

Drop new `*.yaml` files in this directory. Run them individually with
`maestro test .maestro/<name>.yaml` or run everything with
`maestro test .maestro`.

## CI

Not wired into CI yet — running Maestro in GitHub Actions requires either a
macOS runner with an iOS simulator, or an Ubuntu runner with an Android
emulator (`reactivecircus/android-emulator-runner`). When we add this, the
job should:

1. Build the app for the target platform (or fetch from EAS).
2. Boot the simulator/emulator.
3. Install the build.
4. Run `maestro test .maestro`.

The CI workflow at `.github/workflows/ci.yml` deliberately stops at static
checks + unit tests + `expo-doctor` for now to keep PR feedback fast.

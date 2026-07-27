# Apple Auth Implementation Audit & Hardening

Audit the "Login with Apple" implementation for bugs and ensure high test coverage across both Postgres and Firebase adapters.

## User Review Required

- **Native UI vs Web Flow**: The app currently uses a `WebBrowser` flow for Apple sign-in on native devices. This is functional but less "native" than using `expo-apple-authentication`. I've confirmed that the latter is not currently used and am proposing its removal to clean up dependencies.
- **Cookie Path**: I'm broadening the `apple_oauth_nonce` cookie path from `/api/auth/apple` to `/` to ensure maximum compatibility across browsers during the redirect-and-POST callback flow.

## Proposed Changes

### Backend Refactoring & Fixes

#### [app.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/app.ts)
- Broaden `apple_oauth_nonce` cookie path to `/` for robustness.
- Ensure `clearAppleOAuthNonceCookie` uses the same path.

#### [package.json](file:///C:/Git/Tristan/Travel-Itinerary-App/package.json)
- Remove unused `expo-apple-authentication` dependency.

---

### Test Coverage Enhancement

#### [appleOAuthRoutes.test.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/__tests__/appleOAuthRoutes.test.ts)
- Add a comprehensive test case for a successful Apple login callback.
- Mock `exchangeAppleAuthorizationCode` and `verifyAppleIdToken` to simulate the full flow.
- Verify that a JWT token is correctly generated and the user is redirected with an `auth_code`.

#### [NEW] [appleAuthFirebase.test.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/__tests__/appleAuthFirebase.test.ts)
- Implement tests for `findOrCreateAppleUser` specifically against the **Firebase** provider.
- Use the Firebase emulator for realistic data access testing.
- Cover user creation, account linking (by verified email), and subsequent login (by Apple ID).

---

## Verification Plan

### Automated Tests
- Run the new and updated backend tests:
  ```bash
  cd server
  # Run Apple OAuth route tests
  npx jest __tests__/appleOAuthRoutes.test.ts
  # Run Apple Auth parity tests (Postgres/Memory)
  npx jest __tests__/appleAuth.test.ts
  # Run new Apple Auth Firebase tests (requires emulator)
  npx jest __tests__/appleAuthFirebase.test.ts
  ```

### Manual Verification
- Deploy to a staging environment.
- Verify that "Sign in with Apple" still works on both Web and a native iOS build.
- Inspect the `apple_oauth_nonce` cookie in the browser to confirm the updated path.

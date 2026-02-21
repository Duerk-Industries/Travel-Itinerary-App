# Playwright Test Plan: Best Practices

This document outlines best practices for handling authentication and organizing tests for a large-scale Playwright project.

## 1. Handling Authentication

Efficiently managing authentication is key to running tests quickly and reliably. The goal is to log in once and reuse the session across multiple tests. The recommended approach is to use **`storageState`**.

### Recommended Method: Using `storageState` and a Setup Project

Playwright can save cookies, `localStorage`, and `sessionStorage` into a `storageState` JSON file and then create new browser contexts with that state. This completely bypasses the need to log in via the UI in every test file.

**Step 1: Create a Global Setup File**

Create a file that logs in a user and saves the authenticated state.

`tests/global-setup.ts`:
```typescript
import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const { baseURL, storageState } = config.projects.use;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Perform login
  await page.goto(baseURL!);
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Login' }).click();

  // Save authenticated state to a file
  await page.context().storageState({ path: storageState as string });
  await browser.close();
}

export default globalSetup;
```

**Step 2: Configure `playwright.config.ts`**

Update your configuration to use the global setup file.

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Run global setup before all tests
  globalSetup: require.resolve('./tests/global-setup'),

  use: {
    baseURL: 'http://localhost:3000',
    // Use the saved storage state for all tests
    storageState: 'playwright/.auth/user.json',
  },
});
```

With this setup, every test will start as an already authenticated user, making your test suite significantly faster and more stable.

## 2. Organizing Tests for a Large Project

A well-organized project is easier to maintain and scale. The **Page Object Model (POM)** is a widely-used design pattern that makes tests more readable and resilient to UI changes.

### Directory Structure

Group tests and supporting files logically.

```
/
├── playwright/.auth/user.json  # Saved authentication state
├── tests/
│   ├── pages/                  # Page Object Model files
│   │   ├── LoginPage.ts
│   │   └── AccountPage.ts
│   ├── specs/                  # Test files (specs)
│   │   ├── account.spec.ts
│   │   └── create-trip.spec.ts
│   ├── test-utils.ts           # Shared utility functions
│   └── global-setup.ts         # Global setup for authentication
└── playwright.config.ts
```

### Page Object Model (POM)

A Page Object is a class that represents a page or a major component of your application. It encapsulates the locators and the methods to interact with that page.

**Example `AccountPage.ts`:**

```typescript
// tests/pages/AccountPage.ts
import { type Page, type Locator } from '@playwright/test';

export class AccountPage {
  readonly page: Page;
  readonly profileUpdatedMessage: Locator;
  readonly firstNameInput: Locator;
  readonly saveProfileButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.profileUpdatedMessage = page.getByText('Profile updated');
    this.firstNameInput = page.getByPlaceholder('First name');
    this.saveProfileButton = page.getByRole('button', { name: 'Save Profile' });
  }

  async updateFirstName(newName: string) {
    await this.firstNameInput.fill(newName);
    await this.saveProfileButton.click();
  }
}
```

### Using POM in Tests

Your test files become much cleaner as they focus on the test logic rather than implementation details like selectors.

**Example `account.spec.ts`:**

```typescript
// tests/specs/account.spec.ts
import { test, expect } from '@playwright/test';
import { AccountPage } from '../pages/AccountPage';

test('should allow a user to update their profile', async ({ page }) => {
  const accountPage = new AccountPage(page);
  const newFirstName = `TestUser-${Date.now()}`;

  await page.goto('/account');
  await accountPage.updateFirstName(newFirstName);

  await expect(accountPage.profileUpdatedMessage).toBeVisible();
});
```

## 3. Ledger/Cost Report Covering Tests

New unit tests validate expense covering behavior on the Ledger and Cost Report:
- `app/tests/ledger.covered.test.tsx`: Covered travelers are hidden and totals roll up to the covering traveler.
- `app/tests/costReportUi.covered.test.tsx`: Covered travelers are excluded from the report table and totals roll up correctly.
- `app/tests/ledgerCostReportMatch.covered.test.ts`: Cost Report totals match Ledger totals after roll-ups.

By following these patterns, you can build a robust and maintainable Playwright test suite that can easily scale with your application.

## 4. Location Ingestion + Selection Tests

The location-driven trip flow now includes backend ingestion/search, trip persistence, and UI behavior:

- `server/__tests__/locationRoutes.test.ts`
  - Verifies `GET /api/places/search` delegates to location search and returns location rows.
  - Verifies `POST /api/places/batch` resolves selected location IDs for UI rendering.
- `server/__tests__/trip-wizard.test.ts`
  - Verifies wizard trip creation persists `locationIds` in the created trip payload.
- `server/__tests__/itineraryRoutes.test.ts`
  - Verifies itinerary image endpoint now stores fetched image assets in Cloud Storage and returns signed URLs.
  - Verifies cached storage records are re-used and fallback behavior remains safe when upstream image fetch fails.
- `app/tests/createTripWizard.test.ts`
  - Updated helper coverage for trip details validation and known-info description formatting after destination field removal.

### New execution checks

Run all workspace Jest suites:

```bash
npm run test:app
npm run test:server
```

Or from repo root:

```bash
npm test
```

## 5. Email Verification + Invite Onboarding Tests

New server-side tests cover email confirmation and pending invite acceptance/rejection:
- `server/__tests__/account.test.ts`
  - Registration requires verification; login blocked until confirmation.
  - Confirmation link expiration deletes unverified users.
  - Pending trip invites list correctly and acceptance adds trip access.
  - Invite rejection removes the pending member and cleans related trip items.

### Execution

Run server tests:

```bash
npm run test:server
```

Or all tests:

```bash
npm test
```

## 6. Itinerary Status Coverage (Flights, Lodging, Tours, Car Rentals)

The app now supports itinerary item status values:
- `Needed`
- `Proposed`
- `Booked`
- `Cancelled`
- `Completed`

Behavior covered in Jest:
- Status defaults:
  - New items default to `Needed`.
  - Legacy items without status normalize to `Booked`.
- Required-field behavior:
  - `Needed` and `Cancelled` relax business required fields.
  - `Proposed`, `Booked`, and `Completed` keep required-field enforcement.
- Helper-level tests:
  - `app/tests/flights.test.ts`
  - `app/tests/lodging.test.ts`
  - `app/tests/tours.test.ts`
  - `app/tests/carRentals.test.ts`
  - `app/tests/votes.test.ts`

Voting feature route coverage:
- `server/__tests__/itemVotesRoutes.test.ts`
  - member can vote on proposed items
  - followers/non-members are blocked from voting
  - non-proposed items reject votes
  - list endpoints include `netVotes` and `userVote`

# E2E Test Plan — Travel Itinerary App

## Overview

This document is the living test plan for Playwright end-to-end tests. It covers user-perceived quality dimensions that cannot be validated by Jest unit/integration tests: real browser rendering, cross-tab navigation, user-perceived performance, and multi-user shared state.

Tests run against a real HTTP server (in-memory, Firebase emulator, or PostgreSQL). See [docs/faq/testing-and-coverage.md](faq/testing-and-coverage.md) for how to run each variant.

---

## Suite 1 — Authentication (`auth.test.ts`)

**Goal:** Verify that authentication flows work end-to-end, session tokens are persisted, and the performance budget for login is met.

| ID | Test | Key Assertions |
|---|---|---|
| A1 | Register and log in a new user within 5 s | `home-nav-trips` visible; JWT in `localStorage`; `elapsed < 5000ms` |
| A2 | Invalid password shows error message | Error text matching `/invalid\|incorrect/i` visible; `home-nav-trips` absent |
| A3 | Session persists across page reload | After `page.reload()`, `home-nav-trips` still visible |
| A4 | Logout returns to login screen | `getByPlaceholder('Email')` visible; `home-nav-trips` absent |

---

## Suite 2 — Full Trip Creation Wizard (`trip-creation-full.test.ts`)

**Goal:** Cover wizard edge-cases not exercised by the original `create-trip.test.ts`.

| ID | Test | Key Assertions |
|---|---|---|
| B1 | Step-1 validation blocks advance without trip name | `Dates` heading absent after clicking Next on empty name |
| B2 | Back-navigation preserves filled data | Trip Name and Destination retain values after Back |
| B3 | Adding a participant in step 3 shows them in the list | `Jane Doe (jane@example.com)` visible |
| B4 | Wizard step transition under 2 s | `elapsed < 2000ms` after Next click |
| B5 | Month-range dates complete the wizard | Active trip created without error |

---

## Suite 3 — Trip Content Editing (`trip-editing.test.ts`)

**Goal:** Verify CRUD on all five entity types via the tab UIs. Items are pre-seeded via API where possible to keep tests independent.

### Transfers
| ID | Test | Key Assertions |
|---|---|---|
| C1 | Add transfer via flight modal | Row with carrier text visible |
| C2 | Edit transfer carrier | Updated carrier visible; modal open time < 1500ms |
| C3 | Delete transfer | `transfer-row-{id}` absent after delete |

### Lodging
| ID | Test | Key Assertions |
|---|---|---|
| C4 | Add lodging via `lodging-add` button | Hotel name visible in table |
| C5 | Edit lodging name | New name visible |
| C6 | Delete lodging with confirmation | `lodging-row-{id}` absent; ConfirmDialog required |

### Activities
| ID | Test | Key Assertions |
|---|---|---|
| C7 | Add activity via modal | Activity name visible in table |
| C8 | Edit activity name | Updated name visible |
| C9 | Delete activity | `activity-row-{id}` absent |

### Car Rentals
| ID | Test | Key Assertions |
|---|---|---|
| C10 | Add car rental via inline form | Pickup location text visible |
| C11 | Delete car rental | Row text absent after delete |

### Daily Expenses
| ID | Test | Key Assertions |
|---|---|---|
| C12 | Add expense and see it in grid | `expense-cell-{date}-{category}` visible |
| C13 | Open expense detail modal and delete | `expense-delete-{id}` absent after delete |

---

## Suite 4 — Multi-User Group Invitation (`multi-user-group.test.ts`)

**Goal:** Verify the complete Owner → Invite → Accept / Decline lifecycle using two isolated browser contexts sharing one server.

| ID | Test | Key Assertions |
|---|---|---|
| D1 | Owner invites user; invitee accepts via `invite-modal` | `invite-modal` visible; `Active Trip: X` visible for User B after join |
| D2 | Invitee declines invitation | `invite-modal` closes; `Active Trip` absent for User B |
| D3 | Accepted member sees trip after page reload | `Active Trip: X` visible after `page.reload()` |

**Implementation notes:**
- Two `browser.newContext()` instances share the same backend server process.
- Because there is no real-time push, invite arrival is polled via `GET /api/groups/invites` with a 5 s timeout.
- The `invite-modal` is shown automatically on first login when pending invites exist.

---

## Suite 5 — Performance Thresholds (`performance.test.ts`)

**Goal:** Assert that key user journeys meet the Google RAIL model budgets. Measurements use `Date.now()` wall-clock brackets.

| ID | Journey | Budget | Assertion |
|---|---|---|---|
| P1 | Login → `home-nav-trips` visible | 5 000 ms | `elapsed < 5000` |
| P2 | Trip selection → active trip label visible | 3 000 ms | `elapsed < 3000` |
| P3 | Single tab switch (Transfers) | 1 500 ms | `elapsed < 1500` |
| P4 | Four consecutive tab switches | 1 500 ms each | all `elapsed < 1500` |
| P5 | Wizard step advance (step 1 → step 2) | 2 000 ms | `elapsed < 2000` |
| P6 | First Contentful Paint via CDP (Chromium only) | 1 800 ms | `fcpMs < 1800` |

**RAIL model reference:**

| RAIL category | Ideal | Notes |
|---|---|---|
| Response (interaction feedback) | < 100 ms | button click → visual change |
| Animation | < 16 ms/frame | 60 fps |
| Idle | < 50 ms per task | background work |
| Load (first meaningful paint) | < 1 000 ms | "good" ≤ 2.5 s LCP per Core Web Vitals |

The budgets above are calibrated for a full-stack app with a localhost backend. For a remote backend (staging / production), increase each budget by the expected network RTT.

---

## Suite 6 — Trip Management (`trip-management.test.ts`)

**Goal:** Verify trip listing, switching, and that all tabs load without JavaScript errors.

| ID | Test | Key Assertions |
|---|---|---|
| E1 | Created trip appears in trip list | Trip name visible after `home-nav-trips` click |
| E2 | Switch active trip | Active trip label updates; trip load < 3 s |
| E3 | All main tabs load without JS errors | `page.on('pageerror')` collects 0 errors across 6 tabs |
| E4 | Overview shows trip name and group section | Trip name and `/participant\|member/i` text visible |
| E5 | Trips tab accessible from home nav | Trip list or wizard prompt visible |

---

## Test infrastructure

### Shared helpers (`app/e2e/fixtures.ts`)

| Helper | Purpose |
|---|---|
| `registerUser(request)` | POST `/api/auth/register`, returns `UserCredentials` |
| `loginAsUser(page, creds)` | UI login, waits for `home-nav-trips` |
| `loginAsNewUser(page)` | `registerUser` + `loginAsUser`, returns credentials |
| `createSecondUserContext(browser)` | Creates isolated `BrowserContext` for a second user |
| `createTripViaWizard(page, opts)` | Drives full wizard, returns trip name |
| `openTab(page, key)` | Clicks `home-nav-{key}`, waits for `networkidle` |
| `measureMs(fn)` | Returns wall-clock elapsed ms for an async action |

### testID inventory (added for E2E coverage)

See [docs/faq/testing-and-coverage.md](faq/testing-and-coverage.md#testid-naming-convention) for the full naming convention.

Files with added testIDs:
- `app/tabs/LodgingTab.tsx` — `lodging-add`, `lodging-edit-{id}`, `lodging-delete-{id}`
- `app/tabs/activities.tsx` — `activity-add`, `activity-row-{id}`, `activity-edit-{id}`, `activity-delete-{id}`, `activity-form-modal`, `activity-save`, `activity-cancel`
- `app/tabs/transfers.tsx` — `transfer-add`, `transfer-row-{id}`, `transfer-edit-{id}`, `transfer-delete-{id}`
- `app/tabs/dailyExpenses.tsx` — `expense-add-button`, `expense-save`, `expense-cell-{date}-{category}`, `expense-delete-{id}`
- `app/App.tsx` — `car-rental-add`, `car-rental-delete-{id}`, `invite-modal`, `invite-join-{id}`, `invite-decline-{id}`

---

## Known gaps and future work

- **Real-time updates:** Multi-user tests currently require API polling to detect changes from another user. Once WebSocket / SSE support is added (see [realtime-sync-recommendation.md](realtime-sync-recommendation.md)), tests D1–D3 can assert live UI updates without polling.
- **Mobile viewport:** All tests run in Desktop Chrome. Add `{ ...devices['iPhone 14'] }` project to playwright.config.ts to cover mobile layout.
- **Offline / error states:** No tests currently simulate network failures or server errors.
- **Itinerary AI generation:** The `/api/itinerary` async job flow is not covered by E2E tests.

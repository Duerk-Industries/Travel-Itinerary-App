# Test Plan

This document outlines the existing test suites in the Travel Itinerary App, identifies gaps in the test plan, and proposes new tests to fill those gaps.

## Existing Test Suites

### App Tests (`app/tests`)

*   **`carRentals.test.ts`**:
    *   **Purpose**: Tests helper functions for creating and validating car rental drafts.
    *   **Verifies**:
        *   A pickup location, vendor, or model is required.
        *   The default payer is applied correctly.
        *   Input fields are trimmed.

*   **`costReportTotals.test.ts`**:
    *   **Purpose**: Tests the cost report balancing logic.
    *   **Verifies**:
        *   Totals are not inflated when a single payer covers the cost.
        *   Costs are split evenly when no payer data exists.
        *   The remainder is distributed correctly among members.
        *   The overall sum across categories is correct.

*   **`coveredBy.test.ts`**:
    *   **Purpose**: Tests the "covered-by" roll-up logic for cost reporting.
    *   **Verifies**:
        *   A covered traveler's totals are correctly added to the covering traveler.
        *   The covered traveler's original total is removed.
        *   The logic handles multiple travelers being covered by the same person.
        *   The logic works correctly when a covered person has no initial costs.
        *   The logic returns original totals when no "covered-by" relationships exist.

*   **`createTripWizard.test.ts`**:
    *   **Purpose**: Tests helper functions for the "create trip" wizard.
    *   **Verifies**:
        *   Validation of trip details (name is required).
        *   Validation of trip dates (end date after start date, valid dates).
        *   Validation of participants (names required, unique emails).
        *   Computation of trip duration in days.
        *   Building the trip description.
        *   Email normalization (lowercase, trimmed).
        *   Default trip range dates.
        *   Ensuring end date is after start date.
        *   Adding the current user as a default participant.

*   **`flights.test.ts`**:
    *   **Purpose**: Tests helper functions for creating flight payloads.
    *   **Verifies**:
        *   An active trip ID is required.
        *   Departure/arrival times, carrier, flight number, and booking reference are required.
        *   The payload is built correctly with defaults and trip ID.

*   **`dailyExpenses.test.tsx`**:
    *   **Purpose**: Tests the Daily Expenses tab UI behavior.
    *   **Verifies**:
        *   Trip currency is shown in the add-expense form.
        *   Non-zero daily totals open the detail modal when pressed.

*   **`ledger.test.tsx`**:
    *   **Purpose**: Tests the Ledger tab calculations and FX conversion handling.
    *   **Verifies** (now a presentational component):
        *   Renders pre-calculated "Paid" and "Used" totals correctly.
        *   Correctly formats currency values.
        *   Overall row shows matching Paid/Used totals.

*   **`ledgerCostReportMatch.test.ts`**:
    *   **Purpose**: Ensures Cost Report overall shares align with Ledger paid totals.
    *   **Verifies**:
        *   Overall Cost Report per-user totals match Ledger paid totals for the same data.

*   **`tripDetailsCurrency.test.tsx`**:
    *   **Purpose**: Tests trip currency editing in the Trip Details page.
    *   **Verifies**:
        *   Selecting a new currency calls the update handler with the trip ID and currency.

*   **`homeTab.test.tsx`**:
    *   **Purpose**: Tests the Home tab UI behavior.
    *   **Verifies**:
        *   Hero card renders active trip title and opens the trip picker modal.
        *   Trip picker ordering (active first, then no start date, then start date order).
        *   Home navigation buttons trigger page changes.

*   **`itineraryParser.test.ts`**:
    *   **Purpose**: Tests the parsing of itinerary plans into structured data.
    *   **Verifies**:
        *   Parses a basic plan with days and activities.
        *   Parses activities with costs.
        *   Ignores empty lines and lines before the first "Day X" heading.
        *   Handles different formatting (e.g., with or without hyphens).
        *   Parses a multi-day plan.

*   **`lodging.test.ts`**:
    *   **Purpose**: Tests helper functions for lodging.
    *   **Verifies**:
        *   Calculation of the number of nights.
        *   Validation of lodging payload (name, dates).
        *   Calculation of cost per night and application of default payer.

*   **`persistenceFlows.test.ts`**:
    *   **Purpose**: Tests that flight and lodging saves trigger the expected API calls across wizard, tabs, and overview editing flows.
    *   **Verifies**:
        *   Create trip wizard resolves member IDs and posts flight/lodging payloads.
        *   Flight tab uses `POST /api/flights` with trip/payer data.
        *   Lodging tab uses `POST /api/lodgings` with trip/payer data.
        *   Overview lodging edits use `PUT /api/lodgings/:id`.

*   **`session.test.ts`**:
    *   **Purpose**: Tests session persistence utilities used to restore the last active trip on login.
    *   **Verifies**:
        *   Save/load round trip for stored session data.
        *   Clearing session removes stored data.
        *   Expired sessions are ignored.

*   **`overview.test.ts`**:
    *   **Purpose**: Tests utility functions for building the trip overview.
    *   **Verifies**:
        *   Formatting of summaries for flights, lodging, and tours.
        *   Building editing drafts from overview rows for flights, rentals, and tours.
        *   Building overview rows for all categories in the correct order.
        *   Ordering of items within a category by time.
        *   Handling of trips defined by month label instead of a specific start date.

*   **`tours.test.ts`**:
    *   **Purpose**: Tests logic related to tours and their costs.
    *   **Verifies**:
        *   Adding a tour contributes its cost to payer totals.
        *   Removing a tour updates payer totals.
        *   Tour costs are split evenly among payers.
        *   Building a tour payload cleans the cost and applies a default payer.

*   **`traits.test.ts`**:
    *   **Purpose**: Tests the logic for managing user traits.
    *   **Verifies**:
        *   Removing a default trait unselects it but keeps it available.
        *   Removing a custom trait deletes it.
        *   Adding a custom trait selects and stores it.

### Server Tests (`server/__tests__`)

*   **`account.test.ts`**:
    *   **Purpose**: Tests account management APIs (password, family, trips, etc.).
    *   **Verifies**:
        *   Password validation (match, change).
        *   Graceful handling of datastore unavailability during login/registration.
        *   Demographics for new users.
        *   Family relationship lifecycle (create, accept, edit, remove).
        *   Adding and removing members from a trip.
        *   Claiming pending invites on login.
        *   Onboarding flow for new users with/without invites.
        *   Web authentication (register, login, existing user, incorrect password).

*   **`carRentals.test.ts`**:
    *   **Purpose**: Tests the basic logic for adding and removing car rentals from a list.
    *   **Verifies**:
        *   Adding a car rental to a list.
        *   Removing a car rental from a list by ID.

*   **`costReport.test.ts`**:
    *   **Purpose**: Tests cost report calculation APIs across different categories.
    *   **Verifies**:
        *   Cost splitting for lodging (shared, single payer, payer removal).
        *   Cost splitting for tours (shared, single payer, payer removal).
        *   Cost splitting for flights (shared, single payer, payer removal).

*   **`expenses.test.ts`**:
    *   **Purpose**: Tests the expenses API.
    *   **Verifies**:
        *   Creates a new expense for a trip.
        *   Lists expenses by trip.
        *   Deletes an expense by ID.
        *   Stores optional FX conversion fields when provided.

*   **`ledger-integration.test.ts`**:
    *   **Purpose**: Creates a trip with full cost data (flight, lodging, tour, rental, daily expenses).
    *   **Verifies**:
        *   API accepts randomized traveler/payer assignments per item.
        *   Expense list returns expected items with non-empty payer/used lists.

*   **`db-provider.test.ts`**:
    *   **Purpose**: Tests the database provider selection logic.
    *   **Verifies**:
        *   Defaults to postgres when no environment variable is set.
        *   `USE_IN_MEMORY_DB` is respected for backward compatibility.
        *   `DB_PROVIDER` environment variable is honored.
        *   Throws an error for an unknown provider.
        *   Database initialization and closing for memory and postgres (mocked).

*   **`flights.test.ts`**:
    *   **Purpose**: Tests the flights API.
    *   **Verifies**:
        *   Rejects creating a flight without passengers.
        *   Rejects passengers who are not in the group.
        *   Creates and updates a flight with group passengers.
        *   Defaults arrival date to departure date and allows updating it.
        *   Allows creating a flight with a pending passenger.
        *   Rejects pending passengers as payers.
        *   Removes payer status but keeps passenger when a member leaves a trip.

*   **`group-members-pending.test.ts`**:
    *   **Purpose**: Tests handling of pending group members.
    *   **Verifies**:
        *   Surfaces first and last names for pending members.
        *   Adds a pending member with provided names and email.
        *   Rejects whitespace-only names on registration.
        *   Rejects blank pending member names.

*   **`itinerary-traits.test.ts`**:
    *   **Purpose**: Tests itinerary generation and trait lifecycle APIs.
    *   **Verifies**:
        *   Creates and deletes a custom trait.
        *   Generates an itinerary successfully (with a mocked OpenAI response).

*   **`mailer.test.ts`**:
    *   **Purpose**: Tests the email sending logic.
    *   **Verifies**:
        *   `isEmailConfigured` returns the correct status based on environment variables.
        *   `sendShareEmail` throws an error if email is not configured.
        *   `sendShareEmail` calls the `sendMail` function with the correct arguments.

*   **`lodging.test.ts`**:
    *   **Purpose**: Tests the lodging API.
    *   **Verifies**:
        *   Creates a new lodging with an image URL.

*   **`googlePlaces.test.ts`**:
    *   **Purpose**: Tests the Google Places API integration.
    *   **Verifies**:
        *   Returns a photo URL when a place with a photo is found.
        *   Returns null when no place is found.
        *   Returns null when the place has no photo.
        *   Returns null when the API call fails.

*   **`overview-flights.test.ts`**:
    *   **Purpose**: Tests flight editing from the overview.
    *   **Verifies**:
        *   Saves edits for flights with both pending and confirmed passengers, retaining passenger info.

*   **`overview-maps.test.ts`**:
    *   **Purpose**: Tests map link generation for the overview.
    *   **Verifies**:
        *   `buildMapUrl` produces provider-specific URLs (Google, Apple, Waze).
        *   Lodging details include an address link with the preferred map provider.

*   **`trip-wizard.test.ts`**:
    *   **Purpose**: Tests the trip wizard API.
    *   **Verifies**:
        *   Creates a trip, group, invites, and fellow travelers.
        *   Requires a trip name.
        *   Requires participant names.
        *   Rejects duplicate participant emails.

*   **`groups.test.ts`** (New or existing server test):
    *   **Purpose**: To test group-related API endpoints.
    *   **Verifies**:
        *   `PUT /api/groups/:groupId/covered-by` rejects a payload with a circular dependency with a 400 status.
        *   `PUT /api/groups/:groupId/covered-by` accepts and saves a valid payload.

## Proposed New Tests

*   **`costReportCsv.test.tsx`**:
    *   **Purpose**: To verify the CSV export functionality for both "Paid" and "Incurred" expenses from the Cost Report page.
    *   **Verifies**:
        *   The generated CSV string has the correct headers: `Date`, `Category`, and one column for each active traveler.
        *   The CSV rows correctly represent individual expense line items.
        *   The "Covered-By" logic is correctly applied, rolling up costs and excluding covered travelers from the columns.
        *   The correct data (`payerIds` vs `forIds`) is used for "Paid" vs. "Incurred" reports.

*   **`account.test.tsx`**:
    *   **Purpose**: To verify the rendering and user interactions of the `AccountTab` component, especially the "Expense Covering" feature.
    *   **Purpose**: To verify the rendering and user interactions of the `AccountTab` component.
    *   **Verifies**:
        *   The main account profile section renders correctly.
        *   The component correctly renders the child `ExpenseCovering` component.

*   **`ExpenseCovering.test.tsx`**:
    *   **Purpose**: To verify the rendering and user interactions of the `ExpenseCovering` component.
    *   **Verifies**:
        *   The component renders correctly with all travelers and their covering status.
        *   The dropdown for selecting a covering traveler can be opened and used.
        *   Clicking the "Save Covering Rules" button triggers the save handler.

*   **`FamilyRelationships.test.tsx`**:
    *   **Purpose**: To verify the rendering of the `FamilyRelationships` component.
    *   **Verifies**:
        *   The "Family & Relationships" section title and form elements render correctly.
        *   The "Fellow Travelers" section title and form elements render correctly.

*   **`AccountTraits.test.tsx`**:
    *   **Purpose**: To verify the rendering of the `AccountTraits` component.
    *   **Verifies**:
        *   The component renders a card.
        *   The component renders the child `TraitsTab` and passes props to it.

*   **`FamilyRelationships.test.tsx`**:
    *   **Purpose**: To verify the rendering of the `FamilyRelationships` component.
    *   **Verifies**:
        *   The "Family & Relationships" section title and form elements render correctly.
        *   The "Fellow Travelers" section title and form elements render correctly.

*   **`AccountTraits.test.tsx`**:
    *   **Purpose**: To verify the rendering of the `AccountTraits` component.
    *   **Verifies**:
        *   The component renders a card.
        *   The component renders the child `TraitsTab` and passes props to it.

### Utility Tests (`app/utils`)

*   **`formatDateLong.test.js`**:
    *   **Purpose**: Tests the `formatDateLong` utility function.
    *   **Verifies**:
        *   Correctly formats a `YYYY-MM-DD` string.
        *   Strips the time portion from a date-time string.
        *   Handles empty or invalid input gracefully.

*   **`tripDates.test.ts`**:
    *   **Purpose**: Tests date manipulation utilities for trips.
    *   **Verifies**:
        *   `parseDate` parses valid and invalid date strings.
        *   `computeDurationFromRange` calculates the duration between two dates.
        *   `computeEndDateFromDuration` calculates the end date from a start date and duration.
        *   `formatMonthYear` formats a month and year into a string.
        *   `adjustStartDateForEarliest` adjusts the start date based on an earliest possible date.
        *   `getEarliestTripEventDate` finds the earliest date from a list of dates.
*   **`crud-delete.test.ts`**:
    *   **Purpose**: Tests delete endpoints for flights, lodgings, tours, and trips.
    *   **Verifies**:
        *   Delete flight/lodging/tour removes them from trip lists.
        *   Delete trip removes it from the trip list.

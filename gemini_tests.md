# Comprehensive Test Plan (Gemini Generated)

## 1. Authentication & Authorization

### Interactions & Edge Cases:
- **Login via Google OAuth**: User attempts login. Ensure valid sessions. (Suite: E2E)
- **Token Expiry**: User performs an action right as their token expires. Should gracefully refresh or deny. (Suite: Integration)
- **Invalid Tokens**: API calls made with malformed, expired, or revoked JWT tokens. (Suite: Unit/Integration)
- **Cross-Account Manipulation**: User A attempts to edit User B's profile or read their private trip using User B's IDs. (Suite: Integration)
- **Multi-Email Linking**: User links a second email that is already linked to another account. (Suite: Integration)
- **Admin Role Check**: Non-admin user tries to access `/api/admin/*` endpoints directly. (Suite: Integration)
- **Admin Bootstrapping**: First time system boot with bootstrap emails correctly assigns Admin role. (Suite: Unit)

## 2. User Entitlements, Tiers, & Limits

### Interactions & Edge Cases:
- **Limit Inheritance (`getLimit`)**: User on Premium tier falls back to Free tier limits if Premium limit is not explicitly defined. (Suite: Unit)
- **Feature Flags (`canUseFeature`)**: Checking feature flags evaluates correctly based on User ID and current environment. (Suite: Unit)
- **Trip Cap (Free Tier)**: Free tier user tries to create a 4th active trip (limit is 3). Creation should be rejected. (Suite: Integration)
- **Trip Cap Bypass Attempt**: Free tier user concurrent requests to create multiple trips exactly at the limit to exploit race conditions. (Suite: Integration)
- **Tier Downgrade**: Admin downgrades a user from Premium to Free. Verify the user is blocked from premium features immediately (e.g., cost tracking) but historical data is preserved. (Suite: Integration)
- **Usage Recording (`recordUsage`)**: High concurrency usage recording (e.g. AI calls) correctly increments the counter without race condition loss. (Suite: Integration)
- **Feature Flag Toggle**: Admin toggles a feature flag off. Ongoing user sessions immediately lose access to the feature on next API call. (Suite: E2E)

## 3. Trip & Group Management

### Interactions & Edge Cases:
- **Past-Ended Trips**: Non-admin attempts to create a trip whose start/end dates are in the past. (Suite: Unit/Integration)
- **Admin Past-Ended Trips**: Admin creates a past-ended trip successfully. (Suite: Integration)
- **Trip Deletion with Dependencies**: Deleting a trip cascades to delete related expenses, itinerary items, and invites, leaving no orphaned rows. (Suite: Integration)
- **Group Role Changes**: A trip owner changes a user's role from Editor to Viewer while the user is typing/editing. The server should reject the save. (Suite: Integration/E2E)
- **Invite Expiration/Revocation**: User tries to accept an invite that has already been revoked or accepted by someone else. (Suite: Integration)
- **Concurrent Edits (Sockets/Sync)**: Two Editors modify the same trip detail at the same time. Check conflict resolution or last-write-wins behavior. (Suite: Integration)
- **Archiving an Active Trip**: Archiving a trip updates its state and frees up a slot for Free tier limits. (Suite: Integration)

## 4. Itinerary & Scheduling

### Interactions & Edge Cases:
- **Overlapping Events**: User schedules two transfers at the exact same time. System allows it but UI shows a warning. (Suite: Integration/E2E)
- **Timezone Crossing**: Flights that depart in one timezone and arrive in another accurately calculate duration and display correctly. (Suite: Unit)
- **Invalid Geolocation**: Providing invalid lat/long coordinates for a Lodging item throws a validation error. (Suite: Unit)
- **Missing Required Fields**: Submitting an itinerary event missing a start time or destination. (Suite: Integration)

## 5. Cost Tracking & Ledger (Premium)

### Interactions & Edge Cases:
- **Free User Access**: Free user attempts to `GET` or `POST` to ledger/expense endpoints. (Suite: Integration)
- **Split Math Rounding**: A $10.00 expense split 3 ways across users. Ensure the sum equals exactly $10.00 without losing a cent. (Suite: Unit)
- **Multi-Currency Splits**: Expense recorded in EUR, split among users with base currency USD. Check exchange rate snapshotting. (Suite: Unit)
- **Deleting a Split Member**: User is removed from a trip, but they have outstanding expenses in the ledger. Ledger should maintain history or prompt for settlement. (Suite: Integration)
- **Negative Expenses**: User enters a negative expense (e.g., a refund). Ledger accurately updates balances. (Suite: Unit/Integration)

## 6. AI Itinerary Generation

### Interactions & Edge Cases:
- **Successful Generation Quota**: A successful run decrements the user's monthly AI limit. (Suite: Integration)
- **Failed Generation Quota**: An AI timeout or error does NOT decrement the limit. (Suite: Integration)
- **Idempotency**: Submitting the same request twice with the same idempotency key returns the cached result and does not double-charge limit. (Suite: Integration)
- **Prompt Injection/Jailbreak**: Malicious payload in destination or notes attempting to alter AI system instructions. (Suite: Integration/E2E)
- **0-Day Itinerary**: User requests an itinerary where start and end date are the same. (Suite: Unit)
- **Overly Large Context**: Requesting an itinerary for a 6-month trip to see if it gracefully fails or chunks requests. (Suite: Integration)

## 7. Ingestion Pipeline (Email, PDF, Images)

### Interactions & Edge Cases:
- **Malformed File Upload**: Uploading a corrupted PDF or an exe disguised as a PDF. Pipeline should reject gracefully and delete raw file. (Suite: Integration)
- **Oversized File Limit**: Uploading a file exceeding size bounds returns 413 Payload Too Large. (Suite: Integration)
- **Token Budget Exhaustion**: Providing a massive text document that exceeds token limits. The circuit breaker dead-letters the job and creates no parsed items. (Suite: Unit/Integration)
- **Caching Mechanism**: Uploading the exact same PDF twice results in a cache hit (based on `content_hash + logic_version`) and doesn't re-run expensive AI. (Suite: Integration)
- **Deduplication Suppression**: Uploading an email that overlaps significantly with an already processed email correctly suppresses duplicate review items. (Suite: Integration)
- **Concurrent Assignments**: Two users try to assign the same parsed item to different trips simultaneously. One succeeds, the other gets a conflict error. (Suite: Integration)
- **Free Tier Block**: Free user tries to upload to the ingestion endpoint. Receives 403 Forbidden. (Suite: Integration)
- **Raw File Cleanup**: Ensure source files in temporary storage are deleted regardless of pipeline success or failure. (Suite: Integration)

## 8. Real-time Sync & Sockets

### Interactions & Edge Cases:
- **Socket Disconnect/Reconnect**: Client drops connection and reconnects. System should send missing updates since last known state. (Suite: E2E)
- **Stale Client Writes**: A client with a stale view of the itinerary tries to apply an update. The server rejects based on version/timestamp. (Suite: Integration)
- **Broadcast Isolation**: Socket broadcast for Trip A should never leak to users who are only in Trip B. (Suite: Integration)

## 9. Images, Media, & Third-Party APIs

### Interactions & Edge Cases:
- **Unsplash Rate Limit**: Unsplash API goes down or hits rate limits. App gracefully falls back to default colored placeholders or cached images. (Suite: Integration)
- **Unsplash Search Miss**: Searching for an obscure location returns 0 images. Should use fallback. (Suite: Unit)
- **Google Places API Errors**: Passing an invalid Place ID. App should handle Google's error response and map to internal 404/400. (Suite: Integration)

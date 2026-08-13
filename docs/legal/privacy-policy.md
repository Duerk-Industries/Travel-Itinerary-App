# WanderBunnies Privacy Policy

**Last updated: July 21, 2026**

This policy explains what information WanderBunnies ("the app," "we," "us") collects, how we use it, and who we share it with. WanderBunnies is currently operated by Tristan Duerk. [UPDATE ONCE INCORPORATED: replace with the legal entity name once Duerk Industries or successor entity is formally registered.]

If you have questions about this policy, contact us at **tristan.duerk@gmail.com**.

---

## 1. Information We Collect

### Account information
When you create an account, we collect your **first and last name** and **email address**. If you sign in with Google, we receive your name and email from Google (we request only the `profile` and `email` scopes — nothing else).

### Profile and travel preferences
You may optionally provide a **home address**, **preferred airport**, **age**, and **gender**, along with travel preferences (pace, comfort level, interests) used to personalize AI-generated itineraries. All of this is optional.

### Trip and travel data
Information you enter about your trips: destinations, dates, flights, lodging, activities, car rentals, and expenses. Expense amounts are used only for splitting costs among travelers within the app — we do not process payments through this feature.

### Information about other people
Because WanderBunnies is built for group travel, you may enter information about **other people who are not app users** — for example, a travel companion's name and email, a family member's name for relationship tracking, or a passenger's name on a flight confirmation. If you add someone this way, you are responsible for having their permission to share that information with us.

### Forwarded travel documents
If you use our email-forwarding feature to import a booking confirmation, we receive the full content of that email (and any attachments), which may include passenger names, booking references, and other details — including about people other than you.

### Payment information
If you subscribe to a paid plan, payment is handled entirely by **Stripe**, our payment processor. We never see or store your full card number. We do store your subscription status and billing history metadata (e.g., plan tier, renewal date).

### Communications
If you email us or contact support, we keep a record of that correspondence.

### Diagnostic and crash data
We use **Sentry** to automatically collect crash reports and performance diagnostics when something goes wrong in the app, to help us fix bugs.

### What we do **not** collect
We do not access your device's GPS location, camera, photo library, or contacts. We do not use third-party advertising or marketing-analytics SDKs.

---

## 2. How We Use Your Information

We use your information to:
- Create and manage your account
- Let you plan trips, track expenses, and coordinate with your travel group
- Generate AI-assisted itineraries and parse forwarded travel confirmations
- Process subscription payments
- Send account-related emails (verification, trip invites, group invites)
- Diagnose and fix bugs
- Prevent fraud and abuse

We do not sell your personal information, and we do not use it for third-party advertising.

---

## 3. How We Share Your Information

We share information with the following service providers, only as needed to run the app:

| Recipient | What they receive | Purpose |
|---|---|---|
| **Stripe** | Email, payment details | Payment processing for subscriptions |
| **OpenAI** | Trip details, travel preferences; passenger names and booking references when parsing forwarded confirmations | AI itinerary generation and flight-confirmation parsing |
| **Google (Gemini)** | Passenger names and booking references (fallback parser) | Flight-confirmation parsing |
| **Mailgun** | Full content of forwarded confirmation emails | Receiving forwarded travel documents |
| **Sentry** | Crash reports, performance diagnostics | Bug diagnosis |
| **Google** | Name, email (OAuth only) | "Sign in with Google" |
| **Unsplash, Google Places** | Destination/place names you search — no personal information | Destination photos and place lookup |
| **Plaid, Firebase/Google Cloud** | Connected-account transaction data, institution/account identifiers, and encrypted connection metadata — only when you enable the optional import feature | Secure transaction synchronization and expense-import review |

We do not share your information with data brokers or advertisers. We may disclose information if required by law, or to protect the rights, safety, or property of WanderBunnies or our users.

---

## 4. AI Features and Your Data

Some features send your data to third-party AI providers (OpenAI, Google Gemini) to work:
- **Itinerary generation** sends your trip's destinations, dates, budget, and travel-preference data (not names) to OpenAI.
- **Forwarded-confirmation parsing** sends the text of your forwarded email — which can include passenger names and booking references — to OpenAI or Gemini to extract structured flight details.

These providers process this data to return a response to our servers; we do not permit them to use it to train their models on our behalf beyond their standard API data-handling terms.

---

## 5. Data Retention

We retain your information for as long as your account is active. If you delete your account, we delete your trip data, expenses, traits, and family/traveler relationships, and cancel any active subscriptions. Some records may be retained where required by law (e.g., financial records) or in anonymized/aggregated form.

---

## 6. Your Rights and Choices

- **Access and export**: You can download a copy of your data at any time from your account settings (Account → Export Data).
- **Deletion**: You can permanently delete your account and associated data at any time from your account settings (Account → Delete Account). This also cancels any active subscriptions.
- **Correction**: You can edit most of your profile and trip information directly in the app.

If you'd rather not use the app to request deletion, email us at **tristan.duerk@gmail.com** and we'll process the request manually.

---

## 7. Children's Privacy

WanderBunnies is not directed at children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, contact us and we will delete it.

---

## 8. Security

We use industry-standard measures to protect your information, including encrypted connections (HTTPS) and access controls on our systems. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.

---

## 9. Changes to This Policy

We may update this policy from time to time. If we make material changes, we'll notify you through the app or by email. The "Last updated" date at the top reflects the most recent revision.

---

## 10. Contact Us

Questions about this policy or your data? Contact us at **tristan.duerk@gmail.com**.

---

## 11. Optional financial account connections

This section applies only if you choose to enable WanderBunnies' optional Plaid transaction-import
feature.

- **Data received.** Through Plaid, we receive transaction dates, amounts, merchant names, Plaid
  category labels, and the institution/account identifiers needed to keep your connection's data
  separate. Plaid Link handles bank login and multi-factor authentication; WanderBunnies does not
  receive or store your bank username, password, or MFA codes.
- **Purpose and control.** We use this data only to show you recent candidates and let you
  explicitly select and assign individual transactions to a trip expense. Connecting an account
  never silently creates an expense. You can disconnect the account from Account Settings at any
  time.
- **Sharing and use limits.** We do not sell connected-account data or use it for advertising,
  profiling, credit decisions, or unrelated analytics. Plaid and Firebase/Google Cloud process it
  as service providers needed to provide this feature.
- **Retention and deletion.** Disconnecting an account, an applicable Plaid revocation webhook, or
  account deletion stops synchronization and queues deletion of the connection and unconfirmed
  Plaid-derived transaction data. A transaction you explicitly confirmed as a WanderBunnies expense
  remains subject to the ordinary trip-expense retention rules; removing the bank connection does
  not silently erase that expense.
- **Security.** The Plaid access token is encrypted before storage, is never returned to the
  client, and is accessible only to the automated Functions that perform the authorized sync.

This feature-specific disclosure is intentionally narrow. It does not expand the purposes described
elsewhere in this policy, and final provider terms, retention periods, and legal requirements must
be reviewed before production enablement.

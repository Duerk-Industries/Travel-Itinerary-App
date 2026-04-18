# WanderBunnies Travel Itinerary App

WanderBunnies is a shared trip-planning application for web, iOS, and Android. It combines a React Native / Expo client with a TypeScript / Express backend so groups can plan trips together, manage transportation and lodging, track shared costs, and collaborate on itineraries.

## What This Repo Contains

- [`app/`](app) - Expo app for web and native clients
- [`server/`](server) - Express API, auth, data access, and integrations
- [`docs/README.md`](docs/README.md) - documentation hub for architecture, operations, design, and reference notes
- [`FAQ.md`](FAQ.md) - GitHub-friendly FAQ landing page

## Core Capabilities

- Shared trips, groups, invites, and follow-trip flows
- Transfers, lodging, activities, car rentals, expenses, cost reports, and ledger views
- AI-assisted itinerary generation
- Google OAuth plus web/email-based authentication flows
- Web and native support from the same client codebase

## Quick Start

1. Install workspace dependencies:
   ```bash
   npm install
   ```
2. Create `server/.env` from `server/.env.example` and fill in your local settings.
3. Start the API:
   ```bash
   npm run dev
   ```
4. Start the app:
   ```bash
   cd app
   npm start
   ```

For deployment and environment setup, use the guides in [`DEPLOYMENT-GCP-FIREBASE.md`](DEPLOYMENT-GCP-FIREBASE.md) and [`docs/README.md`](docs/README.md).

## Documentation Map

### Start Here

- [Documentation Hub](docs/README.md)
- [FAQ](FAQ.md)
- [Deployment Runbook](DEPLOYMENT-GCP-FIREBASE.md)
- [Test Plan](TEST_PLAN.md)

### Product, UX, and FAQ

- [FAQ Index](docs/faq/README.md)
- [Feature Flags](docs/feature-flags.md)
- [Tiers](docs/tiers.md)
- [Admin Notes](docs/admin.md)

### Auth, Access, and Security

- [Auth Docs Index](docs/auth/README.md)
- [Phase 1 Username + Multi-Email](docs/auth/phase1-username-multi-email.md)
- [Phase 2 Identifier Login + Multi-Email](docs/auth/phase2-identifier-login-multi-email.md)
- [Key Management](docs/security/key-management.md)

### Deployment and Operations

- [GCP / Firebase Deployment](DEPLOYMENT-GCP-FIREBASE.md)
- [GCP Email Ingest Setup](docs/gcp-email-ingest-setup.md)
- [Ingestion Mailbox Deployment](docs/ingestion-mailbox-deployment.md)
- [Ingestion Rollout](docs/ingestion-rollout.md)
- [Realtime Sync Recommendation](docs/realtime-sync-recommendation.md)
- [WebSockets and Chat](docs/websockets-and-chat.md)

### Design and Branding

- [Design Docs Index](docs/design/README.md)
- [Branding](docs/design/branding.md)
- [Travel App Design System](docs/design/travel_app_design_system.md)
- [Component Specs](docs/design/component_specs.md)

### Planning and Reference Notes

- [Expense Tracking Notes](EXPENSE_TRACKING.md)
- [Accounting Fixes](Accounting_Fixes.md)
- [Traits Reference](traits_list.md)
- [Entitlements Implementation Plan](docs/implementation-plan-entitlements.md)
- [Itinerary Generation Debug Plan](docs/itinerary-generation-debug-plan.md)

## Repo Guides by Folder

- [`docs/README.md`](docs/README.md) - main docs index
- [`docs/faq/README.md`](docs/faq/README.md) - split FAQ topics
- [`docs/auth/README.md`](docs/auth/README.md) - auth rollout docs
- [`docs/design/README.md`](docs/design/README.md) - design and theming docs
- [`docs/data/README.md`](docs/data/README.md) - data and catalog strategy docs
- [`server/prompts/README.md`](server/prompts/README.md) - prompt asset references
- [`training_data/ingestion_email_corpus/README.md`](training_data/ingestion_email_corpus/README.md) - ingestion corpus notes

## Testing

- App tests: `npm run test:app`
- Server tests: `npm run test:server`
- End-to-end tests: `npm run test:e2e`
- Full test suite: `npm test`

## Notes for Contributors

- This repo is structured as a monorepo with npm workspaces.
- Some docs are product-facing references, while others are engineering and rollout notes.
- If you are browsing on GitHub, the best entry points are [`README.md`](README.md), [`FAQ.md`](FAQ.md), and [`docs/README.md`](docs/README.md).

# WanderBunnies Travel Itinerary App

WanderBunnies is a shared trip-planning application for web, iOS, and Android. It combines a React Native / Expo client with a TypeScript / Express backend so groups can plan trips together, manage transportation and lodging, track shared costs, and collaborate on itineraries.

## Start here

| I need to… | Guide |
|---|---|
| Run the app or change environment settings | [Configuration and local setup](docs/configuration.md) |
| Understand the running application | [Architecture](docs/architecture.md) |
| Administer users, flags, AI, or imports manually | [Manual administration runbook](docs/operations/manual-administration.md) |
| Test a release and decide whether to promote it | [Rollout testing checklist](docs/operations/rollout-testing.md) |
| Deploy, promote, or roll back | [Production deployment guide](docs/production-deployment-guide.md) |
| Run automated tests | [Test guide](TEST_PLAN.md) |
| Find a feature-specific guide | [Documentation hub](docs/README.md) |

**Release behavior:** pushes to `main` trigger API and Firebase Hosting production deployments independently of CI. Read the [release paths](docs/production-deployment-guide.md#automatic-deploy-on-push-to-main) before merging. The staged deployment scripts are a separate path.

## What This Repo Contains

- [`app/`](app) - Expo app for web and native clients
- [`server/`](server) - Express API, auth, data access, and integrations
- [`packages/`](packages) - shared domain, messaging, analytics, Plaid transaction, and image-size packages
- [`functions/`](functions) - Firebase functions and emulator support
- [`scripts/`](scripts) - deployment, migration, catalog, account, and operational tooling
- [`docs/README.md`](docs/README.md) - documentation hub for architecture, operations, design, and reference notes
- [`FAQ.md`](FAQ.md) - GitHub-friendly FAQ landing page

## Core Capabilities

- Shared trips, groups, invites, and follow-trip flows
- Transfers, lodging, activities, car rentals, expenses, cost reports, and ledger views
- AI-assisted itinerary generation with configurable provider/model routing
- Optional document/email import, receipt scanning and bank-transaction review
- Packing lists, trip blogs, notifications and admin operations (subject to flags and configuration)
- Google OAuth plus web/email-based authentication flows
- Web and native support from the same client codebase

## Quick Start

Requires Node 20+ and npm (the repository declares npm 10.8.2). Run commands from the repository root.

```sh
npm ci
```

Create `server/.env` using the [minimal local configuration](docs/configuration.md#local-setup). The example file includes hosted URLs and optional emulator/HTTPS settings; review it before use. Choose a disposable database for local work.

In separate terminals:

```sh
npm run dev
```

```sh
npm --prefix app run web -- --port 8081
```

Open `http://localhost:8081`; the API defaults to `http://localhost:4000`. Native builds and environment-loading details are in the [configuration guide](docs/configuration.md).

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

### Privacy, Analytics, and Compliance

- [Analytics Upgrade: Collection, Goals, and Behavior](docs/analytics-upgrade.md) — comprehensive overview of analytics collection, privacy goals, default-off opt-in architecture, GDPR/UK GDPR compliance, iOS ATT/Privacy Manifests, and Android Data Safety policies.
- [Analytics Upgrade Implementation Plan](docs/implementation-plans/analytics-upgrade.md) — 5-phase engineering and compliance delivery plan, privacy policy page deliverables, test coverage matrix, performance budgets, and cost model.
- [Analytics Phase 0 Baseline and Review](docs/analytics-phase-0.md)
- [Analytics Manual Follow-ups](docs/analytics-manual-followups.md) — sign-offs, vendor settings, store submissions and deployment checks still to do
- [Analytics and Privacy Runbook](docs/analytics-runbook.md) — kill switches, rollout ladder, monitoring and incident procedures
- [Analytics Sign-off Packet](docs/legal/analytics-signoff-packet.md) — signature blocks, operations evidence tables, and drafts of the user notice and App Review note
- [Analytics DPIA (draft for sign-off)](docs/legal/analytics-dpia.md)
- [EU/UK Representative Assessment (draft for counsel)](docs/legal/eu-uk-representative-assessment.md)

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

- [Gap-Closing Implementation Plan (Map, Discovery, Email Import, Dark Features, Offline)](docs/implementation_plans/implementation-plan-gap-closing.md)
- [Stay22 Integration Plan (hotel affiliate links)](docs/implementation_plans/stay22-integration-plan.md)
- [Expense Tracking Notes](docs/implementation_plans/EXPENSE_TRACKING.md)
- [Accounting Fixes](Accounting_Fixes.md)
- [Traits Reference](traits_list.md)
- [Entitlements Implementation Plan](docs/implementation_plans/implementation-plan-entitlements.md)
- [Itinerary Generation Debug Plan](docs/implementation_plans/itinerary-generation-debug-plan.md)

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
- App and server Jest suites: `npm test` (E2E is separate)
- Type checks: `npm run typecheck`
- [Commands, database variants, and test limitations](TEST_PLAN.md)
- [Manual rollout checks and release evidence](docs/operations/rollout-testing.md)

## Notes for Contributors

- This repo is structured as a monorepo with npm workspaces.
- Some docs are product-facing references, while others are engineering and rollout notes.
- If you are browsing on GitHub, the best entry points are [`README.md`](README.md), [`FAQ.md`](FAQ.md), and [`docs/README.md`](docs/README.md).

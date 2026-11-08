# WanderBunnies Travel Itinerary App

WanderBunnies is a shared trip-planning application for web, iOS, and Android. It combines a React Native / Expo client with a TypeScript / Express backend so groups can plan trips together, manage transportation and lodging, track shared costs, and collaborate on itineraries. Production runs on Google Cloud Run with Firestore and Firebase Hosting.

## Start here

| I need to… | Guide |
|---|---|
| Run the app or change environment settings | [Configuration and local setup](docs/configuration.md) |
| Understand how the application fits together | [Architecture](docs/architecture.md) |
| **Administer users, tiers, flags, cohorts, AI routing or imports by hand** | [Manual administration runbook](docs/operations/manual-administration.md) |
| **Turn on a built feature that is switched off** (maps, Nearby, inbox, offline, imports) | [Feature activation guide](docs/operations/feature-activation.md) |
| Look up a feature flag's default and behavior | [Feature flag guide](docs/feature-flags.md) and [complete flag inventory](docs/feature-flag-inventory.md) |
| **Test a release and decide whether to promote it** | [Rollout testing checklist](docs/operations/rollout-testing.md) |
| Deploy, promote, or roll back | [Production deployment guide](docs/production-deployment-guide.md) |
| Run automated tests (including Firestore) | [Test guide](TEST_PLAN.md) |
| See what is built, what is switched off and what is planned | [Gap-closing plan status](docs/implementation_plans/implementation-plan-gap-closing.md#status-at-a-glance-2026-11-06) |
| Find any other guide | [Documentation hub](docs/README.md) and [complete reference index](docs/reference-index.md) |

**Release behavior:** pushes to `main` trigger API and Firebase Hosting production deployments independently of CI. Read the [release paths](docs/production-deployment-guide.md#automatic-deploy-on-push-to-main) before merging. The staged deployment scripts are a separate path.

## What This Repo Contains

- [`app/`](app) - Expo app for web and native clients
- [`server/`](server) - Express API, auth, data access, and integrations
- [`packages/`](packages) - shared domain, messaging, analytics, Plaid transaction, and image-size packages
- [`functions/`](functions) - Firebase functions and emulator support
- [`scripts/`](scripts) - deployment, migration, catalog, account, documentation and operational tooling
- [`docs/`](docs/README.md) - architecture, operations, design, plans and reference notes
- [`FAQ.md`](FAQ.md) - GitHub-friendly FAQ landing page

## Core Capabilities

- Shared trips, groups, invites, and follow-trip flows
- Transfers, lodging, activities, car rentals, expenses, cost reports, and ledger views
- AI-assisted itinerary generation with configurable provider/model routing
- Document/email import, receipt scanning and optional bank-transaction review
- Packing lists, trip blogs, star ratings, trip templates, chat and notifications
- Maps, Nearby discovery, day ordering and offline trips (built; several are switched off until rollout, see [feature activation](docs/operations/feature-activation.md))
- Google sign-in (Apple sign-in behind an auth setting) plus web/email-based authentication flows
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

## Testing

| Check | Command |
|---|---|
| App and server Jest suites | `npm test` (or `npm run test:app`, `npm run test:server`) |
| Type checks | `npm run typecheck` |
| Server suites on the Firestore emulator (required for data changes) | `npm --prefix server run test:firestore -- <suites>` |
| Browser journeys | `npm run test:e2e` |
| Generated docs and legal pages in sync | `npm run check:docs:flags`, `npm run check:legal` |

See the [test guide](TEST_PLAN.md) for database variants, browser settings and what to validate per change, and the [rollout checklist](docs/operations/rollout-testing.md) for manual release checks and evidence.

## Documentation Map

### Operate the application

- [Operations index](docs/operations/README.md): every operator procedure in one place
- [Manual administration](docs/operations/manual-administration.md) and [admin reference](docs/admin.md)
- [Feature activation](docs/operations/feature-activation.md), [feature flags](docs/feature-flags.md), [flag inventory](docs/feature-flag-inventory.md) and [tiers](docs/tiers.md)
- [Rollout testing](docs/operations/rollout-testing.md) and [release evidence runbook](docs/operations/gap-closing-evidence.md)
- [Production deployment](docs/production-deployment-guide.md), [GCP / Firebase deployment](DEPLOYMENT-GCP-FIREBASE.md) and [native build and store release](docs/expo-deployment-checklist.md)

### Build and change the application

- [Architecture](docs/architecture.md) and [configuration](docs/configuration.md)
- [Test guide](TEST_PLAN.md) and [E2E journeys](docs/e2e-test-plan.md)
- [Contributor instructions](CLAUDE.md)
- [Design docs](docs/design/README.md) and [theme](docs/theme.md)

### Plans and status

- [Gap-closing plan](docs/implementation_plans/implementation-plan-gap-closing.md): maps, discovery, imports, notifications, offline (built), plus the pricing, hotel-booking and parity work still to do
- [Stay22 integration plan](docs/implementation_plans/stay22-integration-plan.md): provider-isolated hotel links
- [All implementation plans](docs/README.md#entitlements-and-implementation-plans)

### Privacy, security and compliance

- [Analytics and privacy runbook](docs/analytics-runbook.md) and [manual follow-ups](docs/analytics-manual-followups.md)
- [Privacy policy source](docs/legal/privacy-policy.md) and [legal document inputs](docs/legal-document-inputs.md)
- [Auth docs](docs/auth/README.md) and [key management](docs/security/key-management.md)

### Product and FAQ

- [FAQ](FAQ.md) and [FAQ index](docs/faq/README.md)
- [Traits reference](traits_list.md), [trip templates](docs/trip-templates.md) and [expense tracking notes](docs/implementation_plans/EXPENSE_TRACKING.md)

## Notes for Contributors

- This repo is an npm-workspaces monorepo.
- Maintained guides (architecture, configuration, operations, tests) describe the current code. Implementation plans describe intent; check the [gap-closing status](docs/implementation_plans/implementation-plan-gap-closing.md#status-at-a-glance-2026-11-06) and live flags before treating a plan as shipped.
- After changing `server/config/feature-flags.yaml`, `FAIL_CLOSED_FLAGS` or `COHORT_FEATURES`, run `npm run docs:flags`.

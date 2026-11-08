# Documentation Hub

This is the main documentation index for the WanderBunnies Travel Itinerary App. For every Markdown reference under this documentation tree, use the [complete reference index](reference-index.md).

## Current application and operator guides

Start with these maintained guides. Implementation plans below capture design intent and historical rollout steps; confirm live enablement and outstanding manual work before treating them as completed deployments.

| Need | Guide |
|---|---|
| Understand the running system | [Architecture](architecture.md) |
| Configure local, test and hosted environments | [Configuration](configuration.md) |
| Administer the application by hand | [Manual administration runbook](operations/manual-administration.md) and [admin reference](admin.md) |
| Turn on a built feature that is switched off | [Feature activation guide](operations/feature-activation.md) |
| Look up any feature flag | [Feature flag guide](feature-flags.md) and [complete flag inventory](feature-flag-inventory.md) (generated) |
| Run automated checks | [Test guide](../TEST_PLAN.md) and [browser journeys](e2e-test-plan.md) |
| Validate and record a release | [Rollout testing checklist](operations/rollout-testing.md) and [release evidence runbook](operations/gap-closing-evidence.md) |
| See what is built, off or planned | [Gap-closing status](implementation_plans/implementation-plan-gap-closing.md#status-at-a-glance-2026-11-06) |
| All operator procedures | [Operations index](operations/README.md) |
| Deploy, promote and recover | [Production deployment guide](production-deployment-guide.md) |
| Complete external/manual prerequisites | [Analytics follow-ups](analytics-manual-followups.md), [ingestion rollout](ingestion-rollout.md), [blog enablement](trip-blog-enablement-runbook.md), [ACL backfill](security/firestore-acl-backfill-runbook.md) |

## Start Here

- [Project README](../README.md)
- [FAQ](../FAQ.md)
- [Deployment Runbook](../DEPLOYMENT-GCP-FIREBASE.md)
- [Test Plan](../TEST_PLAN.md)

## FAQ and Product Behavior

- [FAQ Index](faq/README.md)
- [Overview FAQ](faq/overview.md)
- [Authentication and Access FAQ](faq/auth-and-access.md)
- [API Usage FAQ](faq/api-usage.md)
- [Testing and Coverage FAQ](faq/testing-and-coverage.md)
- [User Administration FAQ](faq/user-administration.md)
- [Look and Feel FAQ](faq/look-and-feel.md)
- [Operations and Constraints FAQ](faq/operations-and-constraints.md)
- [Voting on Items FAQ](faq/voting-on-items.md)

## App Store / App Review

- [App Store Review Response Packet](app-store-review-packet.md) — answers to Apple's App Review Information requirements (screen recording, tested devices, app description, setup instructions, external services, regional differences, regulated-industry/third-party material); update before every submission.

## Deployment, Operations, and Infrastructure

- [Deployment Runbook](../DEPLOYMENT-GCP-FIREBASE.md)
- [Production Deployment Guide](production-deployment-guide.md)
- [Cloud Run OOM (SIGABRT) Remediation Plan](implementation_plans/cloud-run-oom-remediation.md)
- [Admin Notes](admin.md)
- [Feature Flags](feature-flags.md)
- [Tiers](tiers.md)
- [E2E Test Plan](e2e-test-plan.md)
- [Realtime Sync Recommendation](realtime-sync-recommendation.md)
- [WebSockets and Chat](websockets-and-chat.md)
- [GCP Email Ingest Setup](gcp-email-ingest-setup.md)
- [Ingestion Mailbox Deployment](ingestion-mailbox-deployment.md)
- [Ingestion Rollout](ingestion-rollout.md)
- [Security / Key Management](security/key-management.md)

## Privacy, Analytics, and Compliance

- [Analytics Upgrade: Collection, Goals, and Behavior](analytics-upgrade.md) — comprehensive overview of analytics collection, privacy goals, default-off opt-in architecture, GDPR/UK GDPR compliance, iOS ATT/Privacy Manifests, and Android Data Safety policies.
- [Analytics Upgrade Implementation Plan](implementation-plans/analytics-upgrade.md) — 5-phase engineering and compliance delivery plan, privacy policy page deliverables, test coverage matrix, performance budgets, and cost model.
- [Analytics Phase 0 Baseline and Review](analytics-phase-0.md)
- [Analytics Manual Follow-ups](analytics-manual-followups.md) — sign-offs, vendor settings, store submissions and deployment checks still to do
- [Analytics and Privacy Runbook](analytics-runbook.md) — kill switches, rollout ladder, monitoring and incident procedures
- [Analytics Sign-off Packet](legal/analytics-signoff-packet.md) — signature blocks, operations evidence tables, and drafts of the user notice and App Review note
- [Analytics DPIA (draft for sign-off)](legal/analytics-dpia.md)
- [EU/UK Representative Assessment (draft for counsel)](legal/eu-uk-representative-assessment.md)

## Authentication and Account Rollout

- [Auth Docs Index](auth/README.md)
- [Phase 1 Username + Multi-Email](auth/phase1-username-multi-email.md)
- [Phase 2 Identifier Login + Multi-Email](auth/phase2-identifier-login-multi-email.md)

## Design, UI, and Branding

- [Design Docs Index](design/README.md)
- [Legacy Design Index](design/README_INDEX.md)
- [Branding](design/branding.md)
- [Travel App Design System](design/travel_app_design_system.md)
- [Component Specs](design/component_specs.md)
- [Figma Structure](design/figma_structure.md)
- [Dark Mode](design/dark_mode.md)
- [Dark Mode Mockups](design/dark_mode_mockups.md)
- [Charts and Maps](design/charts_maps.md)
- [React Native Theme](design/react_native_theme.md)
- [Tailwind Config](design/tailwind_config.md)

## Data, Catalogs, and Itinerary Generation

- [Data Docs Index](data/README.md)
- [Catalog Source Strategy](data/catalog_source_strategy.md)
- [Future Attraction Data Sources](data/future-attraction-data-sources.md)
- [Itinerary Generation Debug Plan](implementation_plans/itinerary-generation-debug-plan.md)

## Architecture and feature references

- [Current application architecture](architecture.md)
- [Activity/lodging import-export architecture](activity-lodging-import-export-architecture.md)
- [Trip-blog social architecture](trip-blog-social-architecture.md)
- [Travel-blog architecture](travel-blog-architecture.md)
- [Itinerary import/export schema](itinerary-import-export-schema.md)
- [Travel field specification](travel-field-spec.md)
- [Theme implementation](theme.md)
- [Operations guides](operations/README.md)

## Entitlements and implementation plans

- [Implementation Plan: AI Trip Assistant](implementation_plans/implementation-plan-ai-assistant.md)
- [Implementation Plan: Entitlements](implementation_plans/implementation-plan-entitlements.md)
- [Implementation Plan: UX Remediation](implementation_plans/implementation-plan-ux-remediation.md)
- [Implementation Plan: Wanderlog Competitive Analysis](implementation_plans/implementation-plan-wanderlog-competitive-analysis.md)
- [Implementation Plan: Gap Closing (map, discovery, email import, dark features, offline)](implementation_plans/implementation-plan-gap-closing.md)
- [Stay22 Integration Plan (hotel affiliate links, gap-closing §11.3 H1)](implementation_plans/stay22-integration-plan.md)
- [Stay22 Implementation Plan (PRs, tests, rollout)](implementation_plans/stay22-implementation-plan.md)
- [Stay22 Phase 0 Partner Contract Record](implementation_plans/stay22-phase-0-contract.md)
- [Implementation Plan: Itinerary Narrative Depth & Validation](implementation_plans/itinerary-narrative-depth-and-validation.md)
- [Implementation Plan: Itinerary Document Import](implementation_plans/itinerary-document-import.md)
- [GetYourGuide Phase 0 Partner Contract](implementation_plans/getyourguide-phase-0-contract.md)
- [GetYourGuide Phase 2 Server Descriptor](implementation_plans/getyourguide-phase-2.md)
- [GetYourGuide Phase 3 Client CTA](implementation_plans/getyourguide-phase-3.md)
- [GetYourGuide Phase 4 Itinerary Integration](implementation_plans/getyourguide-phase-4.md)
- [GetYourGuide Phase 5 Partner API Enrichment](implementation_plans/getyourguide-phase-5.md)
- [GetYourGuide Phase 6 Operations and Rollout](implementation_plans/getyourguide-phase-6.md)

## Root-Level Reference Notes

- [Expense Tracking Notes](implementation_plans/EXPENSE_TRACKING.md)
- [Accounting Fixes](../Accounting_Fixes.md)
- [Traits Reference](../traits_list.md)

## Training and Internal References

- [Email Ingestion Corpus](../training_data/ingestion_email_corpus/README.md)
- [Ingestion Technical Debt](../server/src/ingestion/TECHNICAL_DEBT.md)
- [Server Prompt Assets](../server/prompts/README.md)
- [Contributor Instructions](../CLAUDE.md)

## Suggested Reading Paths

### For a new visitor

1. [README](../README.md)
2. [FAQ](../FAQ.md)
3. [FAQ Index](faq/README.md)

### For administration or a release

1. [Configuration](configuration.md) and [manual administration](operations/manual-administration.md)
2. [Automated tests](../TEST_PLAN.md) and [rollout checklist](operations/rollout-testing.md)
3. [Production deployment and rollback](production-deployment-guide.md)
4. Relevant subsystem runbook and manual follow-ups from the table above

### For product and UI work

1. [FAQ Index](faq/README.md)
2. [Design Docs Index](design/README.md)
3. [Admin Notes](admin.md)

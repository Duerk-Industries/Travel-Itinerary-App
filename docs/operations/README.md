# Operations guides

[README](../../README.md) · [Documentation hub](../README.md) · [Configuration](../configuration.md)

Everything an operator does by hand: administering accounts and flags, turning features on, testing a release, and deploying. Production runs on Firestore.

## Start here

| I need to… | Guide |
|---|---|
| Change a user's tier or role, toggle a flag, limit a flag to a cohort, fix AI routing or imports | [Manual administration runbook](manual-administration.md) |
| Turn on a built feature that is switched off (maps, Nearby, inbox, offline, imports, automatic adding) | [Feature activation guide](feature-activation.md) |
| Look up any flag's default, missing-row behavior or cohort support | [Feature flag inventory](../feature-flag-inventory.md) (generated) |
| Test a release and decide whether to promote it | [Rollout testing checklist](rollout-testing.md) |
| Record device, deployment and quality evidence for gap-closing features | [Evidence runbook](gap-closing-evidence.md) (`npm run evidence:gap`) |
| Deploy, promote or roll back | [Production deployment guide](../production-deployment-guide.md) |
| Understand an admin page or contract | [Admin reference](../admin.md) |

## Feature records (behavior, configuration and remaining gates)

The activation guide summarizes these. Open the record for full configuration, limits and validation. The [completion audit](gap-closing-remaining.md) is the authoritative status record.

| Area | Record |
|---|---|
| Mail admission, aliases, scanner, offline snapshots, map cache removal | [P0](gap-closing-p0.md) |
| Import setup, structured parsing, Nearby, web map, inbox, trip bundle | [P1](gap-closing-p1.md) |
| Web, public and native maps, keepsake, geocoding, Find locations | [Maps](gap-closing-maps.md) |
| Day order, optimize, Trips like this | [Day order and inspiration](gap-closing-day-order-inspiration.md) |
| Forwarder trust and Gmail confirmation | [Receiver authentication](gap-closing-receiver-auth.md) |
| Trip matching, review and automatic adding | [Matching and review](gap-closing-matching-review.md) |
| Native encrypted storage | [Native storage](gap-closing-native-storage.md) |
| LLM and provider spend reservations | [Advance spend](gap-closing-advance-spend.md) |
| Status, Firestore parity, outstanding work | [Completion audit](gap-closing-remaining.md) |

## Other operator procedures

- [Analytics and privacy operations](../analytics-runbook.md) and [manual follow-ups](../analytics-manual-followups.md)
- [Ingestion rollout](../ingestion-rollout.md) and [mailbox deployment](../ingestion-mailbox-deployment.md)
- [Blog enablement](../trip-blog-enablement-runbook.md)
- [Firestore ACL backfill](../security/firestore-acl-backfill-runbook.md)
- [Key management](../security/key-management.md)
- [Subscription billing checklist](../stripe-premium-subscriptions-checklist.md)
- [Native app build and store release](../expo-deployment-checklist.md)

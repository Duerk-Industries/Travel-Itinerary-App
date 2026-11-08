# Manual administration runbook

[README](../../README.md) · [Admin reference](../admin.md) · [Configuration](../configuration.md) · [Rollout testing](rollout-testing.md)

Use this for routine operator work. Use the [production deployment guide](../production-deployment-guide.md) for deployment, rollback and infrastructure changes. Reviewed against the repository on 2026-11-08; live settings must be checked in the target environment.

## Before making a change

1. Confirm the web/API environment, target account or trip, and intended result. Record the release SHA/revision and current setting when applicable.
2. Sign in with your own admin account and open Admin. Admin routes require a valid JWT and server-side admin role. A hidden button or direct URL is not an authorization mechanism.
3. Record a reason, the previous value and the validation you will run. For bulk changes, review the selected users before submitting.
4. Keep an ordinary Free account and a Premium account available for verification. Admin bypasses tier restrictions, so it cannot validate a Free denial.

Bootstrap emails and the access model are in [Admin](../admin.md#access-model). Role is carried in the token; after a role change, sign in again to obtain a fresh session before testing access. You cannot revoke your own admin role through the role endpoint. Keep another authorized admin available before changing administrator access. Bootstrap accounts are restored to admin/Pro on authentication; changing them manually is not a durable way to test ordinary-user restrictions.

## Change a user's tier or role

1. Open Admin → Users and search by email, name or user ID.
2. Confirm the account identity and current tier/role; select the intended change and supply its reason.
3. Save, reload the user detail and confirm the new state. Check Admin → Audit Log for actor, target and before/after values.
4. With a fresh target-user session, try the relevant operation: trip creation, traveler addition or generation. Check the actual API response, not just the visible button.
5. If incorrect, restore the previous tier/role with a new reason and verify again. A role change may require a new JWT; a billing-managed tier may later be reconciled from subscription state. Check Billing before treating a manual tier edit as a subscription change.

## Enable or disable a feature

1. Open Admin → Feature Flags. Find the exact key in `server/config/feature-flags.yaml` and the consuming service if the label is ambiguous.
2. Record its current value and cohort settings. Check the [flag guide](../feature-flags.md) for dependencies and missing-row exceptions.
3. Change the live flag with a reason. Editing YAML alone only seeds missing rows; it does not change an existing database value.
4. Allow up to 60 seconds for caches across instances. Refresh/reopen the client and test with an intended user and an excluded user when cohorts are configured.
5. Verify both UI availability and backend enforcement. Most shared entitlement denials use HTTP 402 with `{ error, code }`; some intake/integration routes use 403. Check the route's expected contract.
6. Confirm the audit row. To reverse, restore the prior value/cohort, wait for cache expiry and repeat the checks.

To turn on a feature that is built but switched off (maps, Nearby, inbox, offline bundle, imports, automatic adding), follow its row in the [feature activation guide](feature-activation.md). It lists the secrets, schedulers and indexes each one needs first. The [flag inventory](../feature-flag-inventory.md) lists every flag with its seed, its missing-row behavior and whether it supports cohorts.

Admins do not bypass flags. A flag can expose a path that still requires a tier, provider credentials or a separate environment switch. Disablement may prevent new intake without deleting queued work. Required disconnect, revocation and erasure must continue for bank imports. Inspect `STARTUP_FORCE_ENABLE_FEATURE_FLAGS` if a switch re-enables after restart.

## Limit a feature to a cohort

A cohort limits a flag to listed users, which lets you try a feature on yourself and a few accounts before everyone gets it. Only flags marked **Cohort** in the [flag inventory](../feature-flag-inventory.md) support this. The list is `COHORT_FEATURES` in `server/src/services/featureCohorts.ts`.

1. Open Admin → Feature Flags and find the flag. Flags that support cohorts show a cohort editor under the switch.
2. Enter the user IDs (up to 1,000), an **owner** (who is responsible for this rollout) and a **retire after** date in UTC, then save with a reason. API equivalent: `PUT /api/admin/features/:key/cohort` with `{ cohort: { userIds, owner, retireAfter }, reason }`.
3. Turn the flag on. Both must hold: the global flag is on **and** the user is in the cohort.
4. Wait 60 seconds. Check as a listed user (feature present) and as an unlisted user (feature absent, and the API denies it).
5. To widen access, add users. To open it to everyone, remove the cohort (`cohort: null`). To stop it, turn the flag off; that applies to everyone regardless of the cohort.

Rules worth knowing:
- An **empty list** denies everyone.
- An **expired or malformed** cohort also denies everyone. It never widens access.
- Removing the cohort only widens access when the global flag is already on.
- Review each cohort before its retire-after date; once that date passes, the cohort denies everyone, so either extend it or remove it.

## Manage AI routing and investigate a failed generation

Open Admin → AI Operations, select the feature and review available providers/models and operational views. Providers need server credentials; no UI choice creates a credential. Record current routing before changing it. Verify with one synthetic request, inspect its selected provider/model, result and recorded usage/cost, and avoid retrying expensive jobs blindly. Use the [AI capture/evaluation guide](../ai-capture-eval-plan.md) and [generation debug plan](../implementation_plans/itinerary-generation-debug-plan.md) for deeper investigation. Restore the previous routing if validation fails.

## Imports and queues

Use Admin → Ingestion Ops to inspect stage outcomes, duplicates, retries and cost. Confirm the relevant intake flags and Premium parsing policy before troubleshooting an absent upload/forward/Gmail control. Use a synthetic confirmation, upload once, review extracted fields and assign to a disposable trip; replay it to verify duplicate handling. Do not bulk retry or delete raw mail to work around authentication/admission failures. Follow [ingestion rollout](../ingestion-rollout.md), [mailbox deployment](../ingestion-mailbox-deployment.md) and [receiver authentication](gap-closing-receiver-auth.md).

## Billing, privacy and content operations

| Task | Operator entry point and follow-up |
|---|---|
| Premium price/trial/tax/parsing access | Admin → Billing; use the [subscription checklist](../stripe-premium-subscriptions-checklist.md). Verify provider mode, signed webhook processing and resulting entitlement with a test account. A local tier edit does not cancel a provider subscription. |
| Privacy request or failed erasure | Admin → Privacy Requests; record the request/reason, track due dates and failed job steps; follow [privacy rights requests](../analytics-runbook.md#privacy-rights-requests). |
| Packing defaults | Admin → Packing Defaults; review the preset, save, and check a disposable user's packing flow. Do not assume existing user edits are overwritten. |
| Itinerary templates | Admin → Itinerary Templates; follow [template authoring](../trip-templates.md), then create a test trip from the changed template. |
| Usage/cost investigation | Admin → User Data, API Limits, Metrics, Cost Estimator and Analytics; see [Admin reference](../admin.md). Distinguish process-local metrics from persistent usage and privacy-suppressed reports. |

## Missing participant or payer names

1. Confirm the selected trip and its group. Both controls depend on the active group-member roster, not the activity's price or status.
2. In the browser network panel, inspect `GET /api/groups/<groupId>/members`: 401 means refresh authentication; 403 means investigate membership/authorization; a network/5xx failure means investigate the API and retry/reload.
3. Verify that the expected members are not removed and have display names/email/guest details. Check another trip and return to the affected one; test without admin bypass when investigating access.
4. After resolving loading/access, reopen the dialog, select participants and one payer, save and reopen to confirm persistence. Check a newly created and an existing activity.
5. Record the trip/group IDs, revision and response code in the issue. Do not include JWTs, secrets or private travel documents.

## Finish and hand off

Record the operator, UTC time, environment, target, reason, before/after state, audit entry and observed result. Link any release or incident record. If follow-up remains, name the owner and next check rather than marking the operation complete. For a rollout use the [release evidence template](rollout-testing.md#release-evidence).

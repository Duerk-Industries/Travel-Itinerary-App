# Rollout testing checklist

[README](../../README.md) · [Test commands](../../TEST_PLAN.md) · [Manual administration](manual-administration.md) · [Deployment and rollback](../production-deployment-guide.md)

Use this for every web/API release and relevant native release. This is an operator checklist, not a record that a release passed. Mark each check PASS, FAIL or N/A with a reason. Reviewed against deployment scripts on 2026-11-08.

## 1. Identify the release path

**Pushing or merging to `main` triggers production API and Hosting deployments independently of CI.** The separate staged scripts do not prevent those automatic deployments. Decide which path you are using before merging and coordinate the two workflows. The repository does not prove the current GitHub branch protection or cloud configuration; verify those in the target environment.

Prefer the [staged test-to-production path](../production-deployment-guide.md#deploy-to-test) when collecting test evidence. It pairs a backend digest and frontend artifact in a release manifest. Native EAS/store builds are separate releases; record the supported client versions as well.

## 2. Prepare and run automated checks

- [ ] Record operator, commit SHA, change scope, environment and intended flag/cohort state.
- [ ] Confirm test service, Hosting site, database ID, storage/capture buckets, provider credentials and account data are isolated from production. Use synthetic travelers and documents.
- [ ] Review schema changes, Firestore indexes/ACL backfills, worker settings and new secrets. Identify whether rollback remains compatible with the changed data.
- [ ] Run `npm run typecheck`, relevant focused tests and `npm test`; record any excluded suites and why.
- [ ] Run `npm --prefix app run export:web`, `npm run build` and `npm run test:e2e` for web/API release confidence. Use emulator/device checks for affected adapters/native features.
- [ ] For deployment changes, run the deploy/canary suites listed in the [test guide](../../TEST_PLAN.md) and the [dry-run commands](../production-deployment-guide.md#local-dry-runs).

## 3. Deploy to isolated test

Follow one-time setup in the [production guide](../production-deployment-guide.md#one-time-setup). From repository-root PowerShell:

```powershell
.\scripts\current-state.ps1
.\scripts\deploy-test.ps1
```

Use `-Reseed` only if intentionally recreating synthetic fixtures. Keep the resulting `release-manifest-*.json` and matching `release-test-evidence-*.json` from `dist/release` or workflow artifacts. Use the exact pair for promotion; do not select an unrelated latest file. Bash counterparts are documented in the production guide.

The script's smoke check only calls `/api/healthz` and expects 200. Outside E2E the server may report liveness before initialization has completed. Run the functional checks below after startup and inspect errors even if the smoke script passed.

## 4. Manual functional checks in test

Use at least an admin, an ordinary Free account and a Premium account. Use two browser sessions for collaboration. Test at desktop and phone widths; use an actual device for affected native capabilities.

| Action | Expected result / evidence |
|---|---|
| Load the app, sign in, reload, sign out and sign in again | Correct environment/API origin; session survives reload; sign-out removes access; OAuth/deep links work if changed |
| Create a disposable trip with two travelers; switch to another trip and return | Correct trip and member roster each time; no stale data from the previous trip |
| Open a new and an existing activity from both Overview and Activities | Participant names appear; toggle participants, choose one payer, save/reopen; selections persist and appear consistently in costs/details |
| Refresh the roster with a simulated network failure in local test, then retry | Existing names remain on transient refresh failure; later success restores loading; an old trip's response cannot clear the current roster |
| Add/edit lodging, transfer, car rental and an expense | Dates, status and references persist; participant/payer and expense totals remain consistent; invalid input produces a useful error |
| Edit a shared trip in session A and observe/reload session B | Authorized members see the update; unrelated accounts cannot read or mutate it |
| Exercise flags and tier limits using ordinary users | Target access matches recorded settings; disabled/excluded access is denied by the API without writes; admin does not bypass flags |
| Open Admin as admin and as ordinary user | Admin sections load for admin; ordinary user cannot call protected admin APIs |
| Change and restore one test flag/tier with a reason | Correct runtime behavior after cache expiry (up to 60 seconds for flags); audit log contains actor, target and change |
| At phone width, open keyboard and long selectors | Modal remains usable; participants/payer can be selected; Save/Cancel remain reachable without occlusion |
| Check logs, metrics and browser errors | No new startup, permission, asset, worker or failed-save errors; record baseline and observation period |

Run additional feature checks only when enabled or affected; mark N/A explicitly:

- **AI:** submit one controlled itinerary request, wait for completion, inspect selected provider/model and usage; test failure/retry/idempotency where changed.
- **Imports:** synthetic upload → review → assign to disposable trip → reopen item; replay for duplicates; verify disabled intake and worker authentication. Use the [ingestion runbook](../ingestion-rollout.md).
- **Billing:** use the test provider environment, verify signed webhook and resulting tier; use the [subscription checklist](../stripe-premium-subscriptions-checklist.md).
- **Blog/notifications/storage:** verify visibility, authoring, upload and recipients; use [blog enablement](../trip-blog-enablement-runbook.md) and applicable operations guides.
- **Analytics/privacy:** verify consent, kill switches and release evidence using the [analytics runbook](../analytics-runbook.md) and [manual follow-ups](../analytics-manual-followups.md).
- **Native:** installed supported builds must still sign in, edit/save, open deep links and handle keyboard/storage/notification flows. Web/API rollback cannot undo a distributed store binary.

## 5. Promote and verify production

Proceed only when required checks pass, or a named owner explicitly records an accepted exception and its reason. Do not treat missing evidence as a pass.

Follow [promotion](../production-deployment-guide.md#promote-test-to-production) with the exact tested manifest/evidence pair. The [PowerShell checklist](../production-deployment-guide.md#quick-powershell-checklist-test-then-production) shows parameter usage. Confirm the canary and deploy callback secrets/account are configured before starting.

After promotion, record `/api/healthz` SHA/revision and Hosting release, and compare them with the intended manifest. Run the safe login/read paths and an authorized canary/disposable write followed by cleanup. Use the designated internal canary for scripted production smoke writes; verify suppression of external mail/payment side effects. Do not rerun destructive fixture reseeding or provider test purchases on production.

Observe logs, failed requests, persisted writes, worker failures and relevant usage/cost for a recorded period. If traffic is low, explicitly exercise the affected path. Confirm older supported native clients still work before calling the release complete.

## 6. Stop or roll back

Stop promotion for login failures, missing/cross-trip rosters, failed saves, access/privacy leaks, unexpected financial/provider side effects, manifest mismatch or unvalidated schema compatibility. Record the actual failure and preserve traces/logs without tokens or private documents.

If already live, use [rollback](../production-deployment-guide.md#rollback) with a known compatible frontend/backend pair. Restoring runtime flags or routing can contain a feature-specific incident; verify across cache expiry. A traffic rollback does not reverse database writes, schema/backfill changes, provider transactions or native releases. Assign an owner for any data repair and rerun affected functional checks after recovery.

## Release evidence

Copy into the release/incident record; attach script-generated evidence unchanged rather than editing it to add manual results.

```text
Release commit / manifest:
Backend digest / revision / SHA:
Frontend artifact / Hosting release:
Native build(s), if applicable:
Environment / database ID / test accounts:
Operator / reviewer / UTC timestamps:
Configuration fingerprint / flags / cohorts / tier settings tested:
Automated commands and result/artifact links:
Manual checks: PASS | FAIL | N/A (reason), observed result, evidence:
Provider/device checks and cleanup:
Known exceptions / accepting owner:
Promotion decision and time:
Observation window and findings:
Rollback pair / schema compatibility / recovery owner:
Final status and outstanding follow-up:
```

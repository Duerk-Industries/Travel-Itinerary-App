# Firestore ACL Backfill Runbook

## Purpose

Populate `group_access` and `trip_access` for the real Firestore dataset in a controlled way.

This runbook exists because the earlier one-time backfill completed successfully on April 22, 2026, but it targeted the Firestore emulator at `127.0.0.1:8080`, not remote Firestore.

## Safety Model

Use the new guarded script in two phases:

1. `preflight`
2. `apply`

The apply mode refuses to write to remote Firestore unless both of these are true:

- `--allow-remote` is present
- `--confirm-project-id=<resolved-project-id>` exactly matches the resolved project

If `FIRESTORE_EMULATOR_HOST` is set, the script treats the target as the emulator and skips the remote-write guard.

## Commands

### Preflight

```bash
npm run firestore:acl:preflight
```

This prints:

- resolved project id
- database id
- target type: emulator vs remote Firestore
- counts for `groups`, `trips`, `group_access`, and `trip_access`

### Apply To Emulator

```bash
npm run firestore:acl:apply
```

### Apply To Remote Firestore

Make sure `FIRESTORE_EMULATOR_HOST` is unset first.

Then run:

```bash
npm run firestore:acl:apply -- --allow-remote --confirm-project-id=<your-project-id>
```

Example:

```bash
npm run firestore:acl:apply -- --allow-remote --confirm-project-id=travel-itinerary-app-483623
```

## Recommended Production Procedure

1. Verify credentials and target.
   - Ensure `GCLOUD_PROJECT_ID` resolves to the intended project.
   - Ensure `FIRESTORE_EMULATOR_HOST` is not set.
   - Ensure the runtime is using the intended ADC or service-account credentials.
2. Run preflight.
   - Confirm the command reports `target=remote-firestore`.
   - Record the reported counts.
3. Run apply with explicit confirmation.
   - Use `--allow-remote`.
   - Use `--confirm-project-id=<exact-project-id>`.
4. Run preflight again.
   - Confirm `group_access` and `trip_access` counts increased as expected.
5. Spot-check access in the app or admin APIs.
   - owner access
   - group member access
   - follower read-only access
   - removed-user denial

## Operational Notes

- The script runs both group and trip ACL rebuilds by default.
- The same script supports narrower runs:
  - `--scope=group`
  - `--scope=trip`
- Preflight is read-only.
- Apply is idempotent at the projection level because it rebuilds from authoritative records.

## Rollback / Recovery

If the results are unexpected:

1. Stop relying on the changed projections for the affected rollout window.
2. Fix the source records or projection logic.
3. Re-run the same apply command.

Because the projection docs are derived data, recovery should generally be another rebuild rather than a manual document-by-document edit.

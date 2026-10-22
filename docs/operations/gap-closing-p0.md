# Gap-closing P0 implementation and rollout

Implemented 2026-10-19. Source changes are not evidence of deployed configuration,
provider readiness, production agreement rates, or native-device validation.

## Behavior

- Forwarded mail selects an account only through a random 128-bit personal alias.
  The shared address and unknown/rotated aliases return 200 without attribution,
  scanning, parsing, quota consumption, or backscatter. Rotation revokes immediately.
  Claimed sender/authentication headers cannot enable automatic assignment. All
  admitted messages are suggestions requiring the owner's confirmation.
- Receipt, dedupe and monthly quota reservation share an adapter transaction.
  Encrypted raw mail is durable in the database before HTTP 200. No Cloud Run
  worker receives another instance's `/tmp` reference. A scheduler owns processing;
  retryable admission failures return 503, malformed signatures/oversize mail 406.
  Signed timestamps allow the documented eight-hour retry horizon plus one hour;
  timestamps more than five minutes in the future fail. Confirm real provider
  retry signatures before rollout; the documentation does not specify timestamp reuse.
- First release limits: 512 KiB transport, 256 KiB combined fields/file bytes,
  eight files, 32 fields, 40 parts, 64 KiB/field, 15-second ingress deadline;
  larger messages use manual upload. Twenty accepted messages/alias/day and
  twenty pending/held messages/account bound spend and private storage. Cap overflow
  becomes a private hold; a full hold queue drops additional mail with 200.
  Held mail never wakes a scanner or model. Imports shows one pending/held entry
  per receipt, Import once, Delete, and allowance errors. Import once reserves
  quota atomically if it was not already charged.
- Raw mail is authenticated-encrypted with AES-256-GCM, random IV and owner/id AAD;
  alias records carry key version 1. Retention is seven days; successful receipt
  processing immediately clears raw ciphertext and leaves a minimal dedupe receipt
  until expiry. The scheduler cleans expired entries even with admission disabled.
  Ingestion-data deletion revokes aliases and removes receipts. Keep encryption
  secret v1 available throughout retention; changing it without migration prevents
  old aliases/receipts being decrypted. This release does not rotate encryption keys.
- Worker calls are synchronous and authenticated, process at most five receipts,
  use 15-minute fenced leases, exponential retry up to five attempts, then hold.
  If an individual scan/build fails, temporary files already created are removed.
  Receipt retries reconstruct bytes and reuse existing import identities.
- Offline cache v2 keys include immutable user id, backend environment and schema.
  Every download component must succeed. A failed download or storage write keeps
  the last complete copy and surfaces a readable error. Account writes serialize;
  logout invalidates queued writes and clears private views and snapshots. Biometric
  unlock completion is fenced against logout/new login. Email-only legacy data is
  not relabeled because it has no immutable owner proof; download again online.
  Remove the legacy entry only after a new complete commit or explicit logout.
  The 30-day access window remains. Native encryption and browser IndexedDB remain
  their separately staged storage migration; AsyncStorage is not claimed to encrypt.
- Both Google map proxies no longer keep application image caches and respond
  `Cache-Control: private, no-store`. Existing provider reservations/caps remain.
  Removing cache hits increases provider calls, still within those caps.

## Deployment gates and concrete configuration change

1. Apply `server/migrations/20261019_mail_admission.sql` and deploy the additional
   Firestore indexes/field exemption. PostgreSQL uses user-row locks and receipt
   transactions; Firebase uses transactional owner, receipt and usage-counter reads
   and writes. Raw ciphertext is exempt from Firestore indexing. Each admitted mail
   writes a receipt plus counter and owner bookkeeping; each worker attempt writes
   claim and result. Measure contention and reads at representative load.
2. Through the existing audited admin feature-flag editor, set
   `feature_ingest_forwarded_mailbox`, `trip_blog_day_map_render`, and
   `notifications_web_push` to **false** in the target deployment. Seed defaults
   are false, and missing mailbox flags fail closed, but seeds never overwrite an
   existing row. Verify after the 60-second cache interval. Keep manual upload on.
3. Configure a dedicated inbound subdomain/MX matching `INGESTION_ALIAS_DOMAIN`
   (default `in.wander-bunnies.com`), the Mailgun webhook signing secret, and a
   strong `INGESTION_ENCRYPTION_SECRET`. Never put aliases in public links,
   analytics, notifications, or logs. The authenticated config/forwarding routes
   expose only the requesting owner's address. `POST /api/ingestion/forwarding/rotate`
   revokes its predecessor immediately.
4. Deploy a private, authenticated scanner; set
   `INGESTION_VIRUS_SCAN_PROVIDER=clamav_http`, `INGESTION_VIRUS_SCAN_URL`,
   and `INGESTION_VIRUS_SCAN_AUTH_TOKEN`. Confirm the scanner contract below,
   EICAR detection, freshness, cold start, timeout, memory and concurrency behavior.
   Unknown providers throw; a stub cannot serve enabled production mailbox intake.
5. Configure an external scheduler to invoke
   `POST /api/internal/ingestion/mail-receipts/drain` with
   `X-Ingestion-Worker-Secret`, using `INGESTION_WORKER_SHARED_SECRET`.
   Wait for HTTP completion; schedule periodically and retry transient errors.
   Verify crash/lease recovery on separate instances and observable scheduler
   failures, then set `INGESTION_MAIL_RECEIPT_SCHEDULER_READY=1`. This is an operator
   readiness assertion, not automatic provisioning or a process-local timer.
   Mail admission remains fail closed without it. Set matching aggregate ingress
   body/deadline limits and global/IP rate/concurrency limits before buffering.
   Application per-account caps do not replace edge transport abuse controls.
6. Validate genuine Gmail/Outlook/Apple forwarding and receiver authentication
   fixtures. This release intentionally grants no verified-forwarder trust and
   enables no automatic trip writes. Review unfamiliar-sender, full-hold and
   receipt-expiry recovery with users before enabling mailbox admission.
7. Keep existing Google artifact generation paused during applicable account/terms
   review. Audit rows AND bucket objects with provider provenance. Check consumers
   in `blogDayFactsService.ts`, Firebase blog day data, recap/keepsake projections
   before retiring any URL. No artifact deletion is included in this change.
8. Run real PostgreSQL concurrency/rollback tests, Firestore emulator parity and
   named-device native tests (storage-full, interrupted download, account switch,
   unlock/logout races). Jest mocks/pg-mem do not establish these runtime guarantees.
   Offline expense creation remains P2; no new financial queue is introduced here.

## Scanner HTTP contract

POST multipart field `FILES` (generic filename `document`), `Authorization: Bearer
<token>`, and `X-Content-SHA256: <hex digest>`. A 200 is clean only when JSON has
`{"status":"clean","sha256":"<digest of scanned bytes>","signatureUpdatedAt":"<ISO timestamp>"}`.
Digest must match and signatures must be at most 48 hours old (at most five minutes
future skew). A login page, malformed response, stale signatures, mismatched digest,
scanner outage or timeout fails closed. A 406 means infected. Adapt the scanner to
this contract before enabling; legacy services returning bare HTTP 200 are rejected.
Scan success does not prove parser isolation: keep PDF/image/decompression stress
tests and deployment resource bounds in the admission rollout gate.

## Read-only audit and consensus review

From the repo root:

```powershell
npx tsx server/scripts/audit-gap-closing-p0.ts --output=docs/implementation_plans/gap-closing-p0-source-audit.json
# With explicit target environment/credentials, without init/seed/migrate:
npx tsx server/scripts/audit-gap-closing-p0.ts --provider=postgres --output=p0-deployment-audit.json
npx tsx server/scripts/audit-gap-closing-p0.ts --provider=firebase --output=p0-deployment-audit.json
```

The default report records seed values and source references, with deployed values,
artifact counts and consensus measurements explicitly unknown. Deployment reports
contain exact database-referenced `blog-maps/<trip>/<date>/<hash>.png` candidate paths;
keep those reports private. They are cleanup dry runs, never delete instructions.
Enumerate actual objects under those exact paths separately, including generation,
size, owner/provenance and unreferenced objects. Never include user media prefixes.
Review any unrecognized path manually. A separately reviewed resumable deletion
job must recheck provenance/readers and record each result; it is outside this P0
code change.

Use existing admin parser comparisons and representative supported-source fixtures
to assess disagreement/error severity and cost before lowering
`parser_consensus_sample_rate_percent`. The audit provides agreement aggregates,
not a quality decision. No sampling change or forecast saving is claimed here.

## Verification and rollback

Focused Jest coverage includes mail signature/replay, alias rotation, encrypted
receipt recovery, quota/hold ownership, lease fencing, scanner response handling,
map no-cache behavior, capability coverage, partial offline download, storage-full,
concurrent saves and logout fencing. Run both package typechecks as well.

Validated locally with:

```powershell
npm run typecheck:app
npm run typecheck:server
npm --prefix app test -- --runInBand --runTestsByPath tests/offlineSnapshotReliability.test.ts tests/offlineTripCache.test.ts tests/ingestionTab.test.tsx tests/OfflineBanner.test.tsx tests/transfers.test.ts tests/activities.test.ts tests/lodging.test.ts tests/carRentals.test.ts
npm --prefix server test -- --runInBand --runTestsByPath __tests__/ingestion.mailgun.test.ts __tests__/mailAdmission.test.ts __tests__/mailAdmission.firebase.test.ts __tests__/gapClosingFlags.test.ts __tests__/blogCapabilitiesCoverage.test.ts __tests__/staticMapRoutes.test.ts __tests__/tripDayMapRoute.test.ts __tests__/virusScanAdapters.test.ts __tests__/virusScanIntakeWiring.test.ts __tests__/ingestion.routes.test.ts __tests__/ingestion.gmail-disconnect-cascade.test.ts __tests__/ingestion.data-deletion-jobs.test.ts
git diff --check
```

The focused suites were run in smaller batches. Both typechecks passed. No
production deployment/configuration, bucket deletion, real PostgreSQL/Firestore
emulator concurrency trial, scanner deployment, or native-device trial was run.

Disable mailbox admission to stop new work; disabling it also stops receipt
processing, while scheduled expiry cleanup remains available. Preserve recoverable
receipts and review items. Never restore sender lookup or unscanned processing.
Retain expanded tables/indexes on rollback until retained receipts expire. Keep
map artifact generation and browser push off. Offline failures retain their last
complete copy; if necessary stop new snapshot writes and download again online.

Provider reference: [Mailgun route acknowledgement and retries](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http).

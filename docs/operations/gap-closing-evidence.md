# Deployment, device, accessibility, performance and import-quality evidence

The release targets are in [the gap-closing plan, §§8–9](../implementation_plans/implementation-plan-gap-closing.md).
`npm run evidence:gap` creates and checks a release evidence packet against those targets.
It performs no deployment, network call, rollout, provider configuration or data cleanup.
Passing validates the recorded evidence and artifact integrity; reviewers must still verify
that the artifacts establish the claimed outcome. Synthetic tests are not field evidence.

## Collect and check a packet

Use Node 20+ and the workspace dependencies. Work from the repository root on the exact
release commit with a clean working tree. Store the packet and **redacted** artifacts together
in an access-controlled directory; do not commit mail, tokens, private locations or database exports.

```powershell
New-Item -ItemType Directory -Force .artifacts/gap-release
npm run evidence:gap -- init .artifacts/gap-release/packet.json staging
npm run evidence:gap -- check .artifacts/gap-release/packet.json staging
```

Initialization refuses to overwrite an existing packet. The initial check intentionally exits 1:
all deployment, device and accessibility checks start pending, with no invented results.
Fill the packet using actual runs. Keep failed outcomes as failed. Check prints a JSON report
and exits 0 only when every gate passes; malformed inputs, unreadable artifacts and incomplete
evidence exit 1. The environment argument and current `git rev-parse HEAD` must match the packet.
Changing a commit/environment requires a new packet and rerun. Observations and packet creation
must be within 14 days, with no future timestamps. This is an initial evidence freshness policy.

Each check records `status`, UTC `observedAt`, `reviewer`, exact `command` or manual test steps,
`context`, `artifacts`, and `notes` describing expected versus actual behavior. Context always
includes `buildId`; deployments also require `url` and `region`, device/accessibility checks
require `hardware` and `os`, and accessibility requires `assistiveTechnology` (use `none` for
the novice exercise). Device checks require `execution: "physical-device"`. Identify EAS build
IDs, native app versions, browser versions and server revisions in the context or notes.

Artifact entries are `{ "path": "relative/file.txt", "sha256": "<64 lowercase hex characters>" }`.
For example, `(Get-FileHash .artifacts/gap-release/trace.txt -Algorithm SHA256).Hash.ToLower()`
calculates the digest. Artifacts must exist under the packet directory, including after symlink
resolution. Changing their contents invalidates the packet. Retain raw results securely and
hash the redacted copy used for review. Do not treat hashing as provenance or PII removal.

## Required execution

| Area | Collect before marking passed |
| --- | --- |
| Deployment | Runtime flags and reviewed provider policies; scanner clean/EICAR/outage and signature readiness; real receiver/Gmail forwarding with trusted versus uncertain authentication; scheduler and multi-instance crash recovery; Firestore index readiness, contention and cost; deployed shell update from build A to B then offline reload; signed-in offline recovery/revocation; supported-client window and rollback rehearsal. Repeat browser recovery on Chromium, Firefox and Safari, recording versions. Inspect the initial planning bundle for map code. |
| iOS and Android | Use named physical devices and compiled EAS binaries. Follow [native storage acceptance](gap-closing-native-storage.md#acceptance-still-required-on-named-android-and-ios-devices) for encryption bytes/unkeyed access, migration interruptions, full disk, key loss/restore/reinstall, account fencing, retain/discard/logout, suspend/kill/relaunch and stable replay keys. Follow [map activation](gap-closing-maps.md) for gestures, low memory, provider failure, print/share and attribution. Collect actual push receipts on both platforms. |
| Accessibility and usability | Keyboard-only discovery/list/reordering, Imports, offline save and expense repair/export; web screen reader with named browser/reader; VoiceOver and TalkBack on named devices; large text without clipped actions. Test first-run, empty, loading, disabled and error/recovery states. Use at least five unfamiliar participants for uncoached core tasks/recovery; record each task's outcome, require >=80% completion and no unnoticed loss/sharing. |

For `novice-core-tasks-recovery`, context additionally requires numeric strings `completed`
and `participants`, and `unnoticedLossOrSharing: "0"`. Count a participant as complete only
if they finish **all** declared core tasks without coaching. Store anonymized per-task results
in the artifact. A single aggregate total without those observations is insufficient for review.

Firestore is the current deployment adapter. Real Postgres concurrency evidence is additionally
required if Postgres becomes a supported release target; emulator/Jest results do not establish
production index readiness or contention. Receiver, provider and native prerequisites remain
open in [the completion audit](gap-closing-remaining.md#external-evidence-still-required).

## Performance measurements

Add one entry per ID in `performance`. Every entry needs `observedAt`, `reviewer`, `command`,
artifacts, and at least 20 raw nonnegative finite `samplesMs`; include failures/timeouts in the
raw report and fail the relevant acceptance check rather than silently dropping them.
Context requires `hardware`, `payloadMix`, positive integer `concurrency`, `region`, `state`
(`warm` or `cold`), `buildId`, `execution` and `platform`.

| ID | Gate | Required execution |
| --- | --- | --- |
| `nearbyWarm` | p95 <300 ms, `maxCards` <=20, `browseLlmCalls` =0 | `deployed-service`, `state: warm`; record request/response and usage counters |
| `mailReceipt` | p95 <2,000 ms | `deployed-service`; time until durable receipt, not just socket ACK |
| `plainTextImport` | p95 <60,000 ms | `deployed-service`; receipt to available parsed result for declared bounded text payloads |
| `cachedTripOpenIos` | p95 <2,000 ms | `physical-device`, `platform: ios`; named supported phone, complete small cached trip, start after unlock |
| `cachedTripOpenAndroid` | p95 <2,000 ms | `physical-device`, `platform: android`; same journey on a named supported Android phone |

The checker uses nearest-rank p95 (`sorted[ceil(n * .95) - 1]`), separately for each measurement;
do not merge cold and warm samples or payload classes. Attach separate diagnostic tables for
scan, OCR and cold paths, bundle authorization/version versus child reads, payload sizes,
read counts and provider/model costs. Both phone platforms require separate sample series.
`planning-bundle-map-code` must show map code absent from the initial bundle
or link an explicitly reviewed build limitation and measured impact in its notes/artifact.

## Import-quality audit

Populate `imports` with UTC `observedAt`, `reviewer`, exact audit/replay `command`,
`corpusRevision`, `parserVersion`, `matcherVersion`, a representative `samplingPlan`,
redacted artifacts, and item-level `items`. Store fixture IDs and pseudonymous trip labels,
never email addresses or booking references. Each item contains:

```json
{
  "fixtureId": "audited-flight-001",
  "supported": true,
  "source": "verified-forward",
  "itemType": "flight",
  "decision": "auto",
  "expectedTrip": "trip-a",
  "assignedTrip": "trip-a",
  "fieldsCorrect": true,
  "auditedBy": "reviewer-id",
  "undone": false,
  "complaint": false,
  "unnoticedError": false
}
```

Allowed sources: `direct`, `verified-forward`, `uncertain-forward`. Decisions: `auto`,
`suggested`, `held`. Item types: `flight`, `lodging`, `activity`, `car_rental`. Unsupported
and uncertain-forward items must never be auto-added. Include negative cases: overlapping
trips, origin-only/return-leg matches, month-only dates, overnight/DST/unknown timezones,
provider/reference collisions, revoked/followed trips and conflict-safe Undo. Declare the
provider/type/date/language mix and omissions; duplicate fixture IDs fail.

The minimum is **200 audited supported automatic assignments**, not 200 suggestions or
received emails. Count simulated decisions from a suggestion-only pilot as `auto` only when
they represent what the release matcher would have auto-added, explicitly documenting that
no live assignment occurred. Manual expected-trip labels must be independent of matcher output.
`fieldsCorrect` means all required extracted fields match the independently audited fixture.

Precision = supported automatic assignments with correct fields **and** correct non-null trip
divided by all supported automatic assignments. Require >=99%. Any wrong-trip automatic
assignment pauses automation even if aggregate precision passes. Undo >2% pauses expansion;
complaints/unnoticed errors block this conservative gate until investigated and rerun. Track
them independently of precision; Undo alone does not establish accuracy. Reaudit before both
admin-cohort and general release, keeping separate packets and the actual observation window.

## Validation of the tooling

`npm run test:evidence:gap` covers complete/pending packets, missing/duplicate checks,
commit/environment mismatch, stale/future timestamps, invalid inputs, altered/missing artifacts,
physical-device requirements, p95 boundaries, sample counts, task completion, assignment
denominators, precision, wrong-trip, uncertain-forward, Undo and complaint gates. These tests
use synthetic unit-test artifacts and make no deployment/device/import-quality claim.

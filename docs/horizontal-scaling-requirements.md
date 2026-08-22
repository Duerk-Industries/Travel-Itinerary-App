# Horizontal Scaling — Requirements Register

**Status:** Living register. Not a plan, not a commitment to scale — a record of what would have to
be true before this application can run more than one server instance.

**Why this exists.** The app runs single-instance today and several features quietly depend on that.
Each dependency was a reasonable local decision; together they are a constraint nobody wrote down.
This document is that record, so that scaling out is an engineering project with a known scope rather
than a series of production discoveries.

**How to use it.** Two rules:

1. **Before merging anything that adds in-process state**, add a row to §2. A feature that needs
   process-local memory is not forbidden — it just has to be visible here.
2. **Before the first multi-instance deploy**, every P0 row must be closed. P1 rows degrade
   gracefully and can follow.

**Owner:** unassigned. This document has no schedule attached and should not be read as implying one.

---

## 1. Current deployment shape

| Property | Today |
|---|---|
| Runtime | Node.js / Express, single process |
| Hosting | Google Cloud Run (`K_SERVICE` detected at startup by `db.providers.ts`) |
| Instances | Intended to be 1. Cloud Run *can* scale out; the repository does not prove the production service is pinned. |
| Realtime | Socket.IO attached to the same HTTP server in `server/src/index.ts` |
| Presence | In-process `Map` in `server/src/socket/presenceManager.ts`, no Redis |
| Sticky sessions | Not configured |
| Background jobs | In-process, started at boot |

**The single most important consequence:** Cloud Run's default autoscaling means a traffic spike can
silently produce a second instance, at which point realtime features begin to fail *partially* and
without an error — some users see messages, others do not. This is not a hypothetical future concern;
it is a live misconfiguration risk today.

**Immediate mitigation, independent of everything else in this document:** pin
`--max-instances=1` on the Cloud Run service until §3.1 is closed, and document it in
`docs/production-deployment-guide.md`. That is a one-line change and it converts a silent
correctness failure into a capacity limit, which is a far better failure mode.

---

## 2. Register

Severity: **P0** = breaks correctness or user-visible behaviour across instances. **P1** = degrades.
**P2** = inefficiency only.

| # | Component | Dependency on single-instance | Sev | Notes |
|---|---|---|---|---|
| 1 | `socket/presenceManager.ts` | Presence is an in-process `Map`. Instance A cannot see users connected to instance B. | P0 | Users appear offline to half the group. 15s grace period is also process-local. |
| 2 | `socket/chatHandler.ts` | `io.to('trip:'+id).emit(...)` reaches only sockets on the emitting instance. | P0 | Messages silently lost for cross-instance participants. Persisted to `trip_messages`, so history is correct — only live delivery breaks. |
| 3 | Socket.IO transport | No sticky sessions configured; HTTP long-polling upgrade handshake can land on different instances. | P0 | Connection failures/flapping before any application logic runs. |
| 4 | Blog engagement broadcast (planned, `trip-blog-social-architecture.md` §6) | Audience-segmented blog rooms are still process-local. | P0 | REST remains correct; freshness degrades. The room split prevents follower/chat leakage but does not solve cross-instance fanout. |
| 5 | Notification socket delivery (planned, §13.6) | `NOTIFICATION_CREATED` uses a process-local `user:<id>` room. | P1 | Durable inbox/outbox and push are unaffected, so notifications stay **correct** — only socket liveness degrades. |
| 6 | `services/itineraryAsyncService.ts` | In-process async job queue for AI itinerary generation. | P0 | Job state lives in the instance that accepted it. A poll routed elsewhere reports "not found". |
| 7 | `services/documentImportAsyncService.ts` | Same pattern. | P0 | |
| 8 | Startup seeding (`index.ts`: airports, attractions catalog) | Every instance runs the same seed on boot. | P1 | Idempotent, so not incorrect — but N instances do N times the work and can contend on the same rows. |
| 9 | `services/failedRetryScheduler.ts`, `retentionService.ts`, `blogStorageReconciliationService.ts`, `ingestionMetricsService.ts`, `billing/subscriptionReconciliationService.ts`, autocomplete refresh and AI aggregation schedulers | Scheduled jobs start in every process. | P1 | N instances = N runs. Retention/reconciliation can contend; metrics can double-count; billing work must remain idempotent. Inventory every boot-started scheduler before cutover. |
| 10 | Blog nudge/counter/notification jobs (planned) | **Designed safe:** unique window claims and leased outbox work are DB-backed. | — | Closed by design; implementation must pass lease takeover and two-worker tests before its flag is enabled. |
| 11 | TTL caches (feature flags 60s, facts and other service caches) | Per-process. | P2 | Instances briefly disagree or duplicate cache fills. Blog recap is excluded: its planned cache/claim is durable. |
| 12 | `services/httpRateLimitService.ts` | **None — verified safe.** Enforcement goes through `atomicIncrementApiUsageIfUnderLimit` in `db.ts`. | — | Closed. DB-backed and atomic, so limits hold across instances. |
| 13 | `apis/usageLimiter.ts` (`reserveApiUsageOrThrow`, `reserveCapacityOrThrow`) | **None — verified safe.** Rolling usage and retained-capacity reservations use durable atomic DB primitives. The in-process Maps hold logging/cache state, not enforcement. | — | Closed. Per-instance duplicate *log lines* at threshold crossings are the only effect. |
| 14 | `services/gmailPollingService.ts` | Polling loop per instance. | P1 | Duplicate ingestion of the same mailbox. |
| 15 | `redirects.ts` native auth exchange codes | One-time OAuth/native exchange codes live in an in-process `Map`. | P0 | Code created on instance A and consumed on B fails login; retry may be unsafe/confusing. Store hashed, single-use, TTL-bound codes durably. |
| 16 | Postgres connection pool | Each instance creates its own pool; aggregate connections grow as `instances × pool max`. | P0 | A scale-out can exhaust Postgres before CPU. Define a total connection budget, per-instance max, headroom and connection-proxy decision before raising instances. Firebase has separate SDK/channel quotas that need the same multiplication check. |
| 17 | Process-local metrics (`metrics.ts`) | Counters/gauges represent one instance and `/metrics` scraping does not produce a global view by itself. | P1 | Dashboards/alerts can undercount or double-sum gauges. Export per-instance labeled metrics and aggregate with correct counter/gauge semantics. |
| 18 | In-flight dedupe and refresh locks (`utils/inflightDedupe.ts`, provider/cache service Maps, `blog/syncCoordination.ts`) | Duplicate suppression is per process. | P2 | Correctness remains durable, but N instances can multiply provider calls, syncs and cache fills. Provider caps remain DB-atomic; add distributed single-flight only where measured cost justifies it. |
| 19 | Notification outbox and recap snapshots (planned) | **None by design.** Claim/lease state is durable and adapter-native. | — | Closed when conformance tests prove only one worker owns a lease and expired leases recover after a crash. |

Rows 10, 12, 13 and 19 are designed or verified safe — API limits already enforce
through the atomic DB path rather than process memory. They are listed rather than omitted because
"are our rate limits still real when we scale?" is the first question anyone will ask, and the answer
should be findable here rather than re-derived.

---

## 3. What closing each class requires

### 3.1 Realtime (rows 1–5) — P0

- **Redis** (Cloud Memorystore) as shared state, plus `@socket.io/redis-adapter` so room broadcasts
  cross instances.
- **Presence moves to Redis** with TTL-based expiry replacing the in-process grace timer. Presence
  becomes eventually consistent; the UI already tolerates that.
- **Sticky sessions**, or force `transports: ['websocket']` to skip the polling upgrade entirely.
  The latter is simpler and works everywhere the product already runs, at the cost of environments
  that block WebSocket.
- **Test:** two instances behind a load balancer; a client on each; assert message, presence and
  blog-engagement delivery in both directions. Also assert a follower blog subscriber receives no
  traveler chat. This test is the definition of done for this class.

### 3.2 Background jobs (rows 6, 7) — P0

Job state must leave the process. Options, cheapest first:

1. **DB-backed job table** with a claim/lease pattern (`SELECT … FOR UPDATE SKIP LOCKED`). No new
   infrastructure, fits the existing adapter model, and the Firebase adapter has an equivalent.
2. Cloud Tasks / Pub-Sub. More robust, more moving parts, more cost.

Option 1 is the recommendation — it matches how the rest of this codebase already works, and neither
job is high-throughput.

### 3.3 Scheduled jobs (rows 8, 9, 10, 14) — P1

Leader election, or a scheduler that is not the application. Cheapest workable answer: a
`scheduled_job_runs` table with an advisory lock or a unique `(job_key, window_start)` row, so only
the first instance to claim a window runs it. That also gives observability into whether jobs ran,
which does not exist today.

Alternatively, move them to Cloud Scheduler hitting an authenticated internal endpoint — which the
codebase already has a pattern for in `internalBlogWorkerRoutes.ts`.

New work does not get to inherit the unsafe pattern merely because old jobs use it. Trip-blog recap,
notification delivery, nudges and counter reconciliation use DB claims/leases from their first
release. Existing schedulers can migrate incrementally, but every one must be inventoried and either
leased, externally scheduled or proven harmless before multi-instance cutover.

### 3.4 Rate and usage limits (rows 12, 13) — closed

No work required. Both enforce via `atomicIncrementApiUsageIfUnderLimit`, which is atomic at the
database. Any *new* limiter must use the same path rather than a process-local counter — that is the
rule this section exists to preserve.

### 3.5 Caches (row 11) — P2

Leave as is. Per-instance TTL caches are a normal, acceptable pattern; the only visible effect is
that a feature-flag flip propagates within the existing 60s window per instance rather than globally
at once.

### 3.6 Auth exchange and connection capacity (rows 15, 16) — P0

- Move native redirect exchange codes to the active database, storing only a hash, expiry and
  single-use consumed marker. Consumption must be atomic and tested concurrently across two clients.
- Define `maxInstances × poolMax ≤ databaseConnectionBudget - operationalHeadroom`; make invalid
  deployment combinations fail CI/deploy validation. Add PgBouncer/managed pooling only if direct
  pool sizing cannot meet latency and connection targets.
- Load-test the same deployment shape intended for production. A two-process localhost test proves
  coordination logic, not Cloud Run connection behavior.

### 3.7 Observability and duplicate work (rows 17, 18) — P1/P2

Label exported metrics by service/revision/instance and define which series are summed (counters) vs.
max/last-valued (gauges). Keep distributed single-flight optional: DB-atomic provider limits already
bound cost, so add Redis locks only for measured hot keys rather than making Redis a dependency for
every cache.

### 3.8 Scaling cost gate

Before raising `max-instances`, extend `cost-model.yaml` with low/base/high and cap-driven scenarios
for: minimum Cloud Run instances, Redis/Memorystore fixed monthly floor and operations, load-balancer
and cross-zone egress, increased database connections/reads, external scheduler or task requests, and
duplicate cache-fill/provider work. Compare that total with vertical scaling. “Technically scalable”
is not sufficient if the shared-infrastructure floor costs more than the traffic it serves.

---

## 4. Non-goals

- **Multi-region.** Nothing here addresses data locality, replica lag or regional failover.
- **Zero-downtime deploys.** Related but separate.
- **Database data-model scaling.** Query/index/partition design is separate; connection multiplication
  is in scope because it is caused directly by application instance count.
- **Choosing to scale.** This register defines prerequisites and cost inputs, not the traffic level at
  which horizontal scale beats a larger single instance.

---

## 5. Change log

| Date | Change |
|---|---|
| 2026-08-22 | Created. Seeded from the single-instance dependencies found while designing the trip blog social layer (`trip-blog-social-architecture.md` §12.2), plus an audit of existing in-process state. Rows 4, 5 and 10 are planned-but-unbuilt; the rest are live today. |
| 2026-08-22 | Review update: added native auth exchange, connection-budget, metrics and duplicate-work gaps; required new blog jobs/outbox/recap to be lease-safe from launch; added follower/chat isolation and a cost gate. |

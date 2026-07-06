# Chapter 16 — Test Deployment, Production Cutover, and Rollback

## 1. Purpose and Scope

This chapter designs a durable, scriptable **test (staging) deployment**
of the whole application (frontend + API + database), separate from
production, with a controlled **cutover** path that promotes a validated
build to production without ever touching live production data, plus an
explicit, confirm-gated path to retire the previous production version
once the team is confident.

This applies to the application as a whole (it is the deployment
substrate everything in Chapters 1–15 runs on top of), not only the AI
platform — but §7 calls out the AI-platform-specific consequences (test
traffic must never spend production's AI budget or land in production's
capture buckets) since that's this document set's focus.

**Decisions already made** (confirmed with the project owner before
writing this chapter):

| Question | Decision |
|---|---|
| Test environment's data | **Isolated, synthetic/fixture data** — its own database, never a copy of real user data |
| What "cutover" does mechanically | **Code-only promotion** — production's database and public URL never change; cutover promotes validated code to the existing production service |
| Old production after cutover | **Kept as an instant rollback net**, then torn down via a **separate, explicit, confirmed** step — never deleted automatically by the cutover script itself |
| Production domain | **Custom domain already mapped** (`duerk.org`, via Firebase Hosting) |
| Build/promotion mechanism | **Build-once, promote-by-digest** (§2.1) — cutover deploys the exact image digest validated in test, not a fresh rebuild from source |
| Test Firestore isolation | **Same GCP project, second named Firestore database** (§2.2) — `travel-itinerary-app-test-database`, mirroring how production already uses a named database |
| Test AI vendor API keys | **Separate, low-budget keys** (§2.3) — isolates vendor-side spend, not just this platform's internal cost tracking |

### Principal Architect Review Notes

This deployment chapter makes the right core call: promote an already
validated artifact into production rather than rebuilding during
cutover. The main improvements are to make the "artifact" boundary
include the frontend export, make cutover evidence durable, and clarify
which manual decisions still require an operator:

- **A release is a manifest, not just a Cloud Run digest.** The backend
  image digest, frontend export artifact ID/hash, git SHA, Firestore
  index version, config fingerprint, and smoke-test result should travel
  together as one immutable release record. Cutover promotes that
  manifest.
- **Frontend promotion must be build-once too.** The current backend
  digest story is precise, but Firebase Hosting needs the same discipline
  via a stored `dist/` artifact or release bundle, not a fresh web export
  during production cutover.
- **Direct production deploy remains an exception path.** `deploy-prod.sh`
  is necessary for emergency hotfixes and config-only changes, but it
  should require a reason, write audit evidence, and be visible as a
  bypass of the normal test-to-prod path.
- **Rollback has two planes.** Cloud Run revision rollback and Firebase
  Hosting rollback must be tested as a paired operation. A backend-only
  rollback may be enough for some incidents, but the runbook should force
  the operator to decide explicitly.

Resolved owner decisions for the first implementation pass:

1. Immutable frontend artifacts live in **GitHub Actions artifacts** for
   now. This is adequate for the first release pipeline because it keeps
   artifact custody next to the build that produced it. Revisit GCS or
   Artifact Registry if retention requirements exceed GitHub artifact
   retention or if deploys need to run without GitHub Actions context.
   **Retention period: GitHub's own default (90 days) is sufficient** —
   `ROLLBACK_RETENTION_DAYS` (§4) defaults to 7 days, so the artifact
   retention window has wide margin over the rollback window it needs to
   outlive. Ownership of increasing it, if ever needed, sits with
   whoever maintains the CI workflow config (`.github/workflows/`) — no
   new role or process required, just the standard PR-review path any
   workflow-file change already goes through. Revisit only if an actual
   rollback need arises for an artifact older than 90 days, which would
   itself be a signal to move to GCS (per the "revisit" note above)
   rather than just raising the GitHub retention number.
2. Production cutover, rollback, and direct production deploy authority
   is limited to the app owners: Bryan and Tristan. **Identity source:
   the GitHub Actions `github.actor` context** (or the workflow's
   OIDC-derived identity, if this pipeline ever authenticates to GCP via
   Workload Identity Federation instead of a long-lived service-account
   key) — checked against a small allowlist in the workflow/script, not
   `gcloud auth list` or the Cloud Build service account identity,
   neither of which naturally distinguishes "which human triggered
   this." **Consequence, stated explicitly since it's a real
   constraint, not a footnote:** this means `cutover-test-to-prod.sh`,
   `rollback.sh`, `teardown-old-production.sh`, and `deploy-prod.sh`
   must only be invoked through the GitHub Actions workflow, never as a
   bare local script run — there is no `github.actor` to check outside
   that context. `--dry-run` (§8.6) remains fine to run locally by
   anyone, since it has no side effects requiring authorization; only
   the real, mutating invocation is workflow-gated. If a genuine
   break-glass need for local execution ever arises (e.g. GitHub Actions
   itself is down during an incident), that needs its own explicit
   decision — don't silently allow a `gcloud auth list` fallback path
   that reintroduces the identity-source ambiguity this decision was
   meant to close.
3. Initial production canary write surface should align with the
   current AI rollout focus: ingestion/parsing smoke checks first,
   avoiding billing writes and avoiding broad user-visible data changes.
   **The canary's ingestion/parsing check runs through `TestAiProvider`,
   not real provider keys** — deterministic (no dependence on a live
   vendor's current behavior/latency), zero real vendor cost on every
   single cutover (this runs on every promotion, not occasionally, so a
   real-key smoke check would mean recurring vendor spend purely for
   plumbing verification), and it already exists as first-class platform
   infrastructure (Chapter 3's testing provider) rather than something
   this chapter needs to build. This does **not** mean production's real
   provider adapters go unverified end-to-end — that's what Chapter 1's
   provider contract suite (run against real credentials in CI, Phase
   1.6) already covers; the cutover canary's job is narrower: confirm
   the deployed candidate's ingestion pipeline is wired up and reachable
   against production's real database, not re-prove the provider
   adapters work.
4. Production cutover is immediate 100% traffic for now. Keep
   `--staged 10,50,100` as an optional flag, not the default.
5. Deployment evidence should be written to GitHub deployment records
   and Cloud Logging even if the app API is unavailable; `audit_log`
   remains the in-app audit trail when the API is healthy. Do not make
   `audit_log` the only source of truth for a failed cutover.
6. **Cutover duration SLO: under 5 minutes end-to-end for steps 1–9**
   (§5.4), excluding the golden-fixture regression suite (9.8) which may
   legitimately run longer — that gate should complete within 10 minutes
   total, separately budgeted, since it's a broader correctness check
   than the smoke suite and blocking cutover on it is intentional (§9.8)
   even though it costs more time than the rest of the pipeline
   combined. This turns §8.1's "low single-digit minutes" into a
   concrete, testable number rather than a vague target — if the
   pipeline ever exceeds either budget, that's a signal to profile
   `smoke-test.sh` or the build step, not to quietly widen the SLO.

### Grounding: current production architecture (confirmed from the repo, not assumed)

- Backend API: Cloud Run service **`travel-itinerary-app`**, region
  **`us-east5`**, deployed via `gcloud run deploy --source server`
  (`scripts/deploy-api.sh`, and `.github/workflows/deploy-api.yml` on
  push to `main`).
- Frontend: Firebase Hosting, serving `dist/` (the Expo web export),
  with `firebase.json` rewriting `/api/**` and `/socket.io/**` to the
  Cloud Run service above. Custom domain **`duerk.org`** is mapped at
  the Hosting layer, not directly on Cloud Run — Cloud Run itself is
  never addressed by end users or native apps.
- Database: Firestore, **named database `travel-itinerary-app-database`**
  (not the `(default)` database), region `us-east5` — confirmed in
  `firebase.json`. Firestore's multi-database-per-project support is
  therefore already in active use here, which matters directly for §3.
- IAM: three service accounts already exist by convention (deployer,
  Cloud Build, runtime) per `scripts/configure-gcp-iam.sh` /
  `DEPLOYMENT-GCP-FIREBASE.md` §2.
- Existing PR-preview mechanism: `.github/workflows/firebase-hosting-pull-request.yml`
  already deploys ephemeral Firebase Hosting **preview channels** per
  pull request. **This chapter's "test" environment is a distinct,
  long-lived thing, not that mechanism** — preview channels expire
  (default 7 days, max 30) and share the production Cloud Run backend
  and production Firestore today. Don't conflate the two; a stakeholder
  reading "test deploy" should understand this is a persistent
  staging environment with its own backend and its own data, and the
  existing PR-preview flow is unaffected by anything in this chapter.

---

## 2. Confirmed Design Decisions

The three choices below were genuine judgment calls with real
trade-offs; all three have been confirmed by the project owner and are
now settled design, not open questions. Rationale is kept below since it
explains *why*, which matters for anyone revisiting this later.

### 2.1 Build-once, promote-by-digest — confirmed

Switch from the current `gcloud run deploy --source` flow (which
triggers a fresh Cloud Build from source *every time it's invoked*,
including at cutover) to a **build-once, deploy-twice** pipeline: build
a container image tagged with the git commit SHA, push it to Artifact
Registry once, and deploy that exact image (by digest) to the test
service first, and — at cutover — deploy that *same* image digest to
the production service. Cutover becomes "point production at the digest
that already ran in test," not "rebuild from the same source and hope
the result is identical." This is a small change to `deploy-api.sh`
(`--image <digest>` instead of `--source server`) and is what makes
"promote the exact validated artifact" a literal guarantee rather than
an assumption. Requires an Artifact Registry repository (one-time
setup) and a build step that isn't tied to `gcloud run deploy`'s
convenience `--source` mode — see §5.1.

### 2.2 Test Firestore: second named database in the same project — confirmed

Create a second named Firestore database
(`travel-itinerary-app-test-database`) in the **same** GCP project,
mirroring how production already uses a named database rather than
`(default)`. This is minimal new setup (one `gcloud firestore databases
create` call), fully isolated data (a named database is a completely
separate document store — no shared collections, no risk of a query
crossing over), and reuses every existing IAM/billing/API-enablement
decision already made for this project. This is a weaker security
boundary than a wholly separate GCP project would be (anyone with
project-level Firestore access can reach both databases), which is why
IAM scoping for the test runtime service account (§3, §8.4) matters —
it's the control that keeps this trade-off acceptable at this project's
current scale. Revisit if the team or its access model grows to include
people who shouldn't have any path to production data at all.

### 2.3 AI provider API keys for test: separate, low-budget keys — confirmed

Test's Firestore isolation (§2.2) automatically isolates this
platform's *internal* cost tracking (`ai_provider_config`,
`admin_settings`, `api_cost_counters` all live in test's own database),
but it does **not** isolate spend at the vendor (OpenAI/Anthropic/etc.)
if test reuses production's API keys — a runaway test-environment loop
would still burn real production budget at the vendor. Provision
separate API keys for test, with the lowest budget/rate cap each vendor
allows, through the same Secret Manager + `configure-run-env.sh`
mechanism already used for production secrets.

### 2.4 Test domain: `test.duerk.org` — confirmed

The test environment is mapped to the subdomain `test.duerk.org` rather
than a bare Firebase-generated `*.web.app` URL. The domain value itself
is not hardcoded anywhere in checked-in source — it lives in
`scripts/deploy.config`'s `TEST_DOMAIN` key (§4) and is read by the
scripts and by a small config-templating step (§4) that generates the
Hosting rewrite/CSP config at deploy time. Changing it later (e.g. to a
different subdomain) is a one-line config edit, not a code change.
Connecting the DNS record itself is a one-time manual step, covered in
§4's setup checklist, since it requires access to the domain registrar.

### 2.5 Scope: web + API only, not native/EAS builds

Native iOS/Android builds (Expo/EAS) are out of scope for this test/
cutover mechanism — they already have their own build-channel story via
EAS and point at `https://duerk.org/api` by convention. Nothing in this
chapter changes that; a native dev build pointed at the test API URL
during manual QA is possible but is a manual Expo config change, not
something the scripts below automate. Flag if you want that automated
too — it would mean adding a third EAS build profile pointed at the
test API URL.

---

## 3. Environments and Topology

| | **Production** (existing) | **Test / Staging** (new) |
|---|---|---|
| Cloud Run service | `travel-itinerary-app` | `travel-itinerary-app-test` |
| Region | `us-east5` | `us-east5` (keep identical to production so performance characteristics are comparable) |
| Firestore database | `travel-itinerary-app-database` | `travel-itinerary-app-test-database` (§2.2) |
| Firebase Hosting site | default site, custom domain `duerk.org` | second Hosting site (`travel-itinerary-app-test`), mapped to subdomain **`test.duerk.org`** (§2.4) |
| AI capture bucket (Chapter 4 §10) | `gs://<PROD_AI_CAPTURE_BUCKET>/` | separate bucket or clearly separated prefix, **never** the same bucket as production |
| Vendor API keys | production keys, production budgets | separate, low-budget keys (§2.3) |
| Runtime service account | existing production runtime SA | a **new, separate** runtime SA scoped only to test's Firestore database, test bucket, and test secrets — extending the existing three-service-account pattern in `setup-iam-permissions.sh` with a fourth, test-scoped identity. A bug or compromise in the test environment must not carry production-reachable credentials. |
| Deployer/CI identity | existing deployer SA (GitHub Actions) | can remain shared, since every script call explicitly names its target service/database — the deploy scripts, not the identity, are what should make prod-vs-test unambiguous |

CSP note: `firebase.json`'s `Content-Security-Policy` header currently
hardcodes `https://duerk.org` in several directives. Rather than
hand-maintaining a second static JSON file with `test.duerk.org`
hardcoded in it (which would silently drift from config the moment
`TEST_DOMAIN` ever changed), §4 generates the test Hosting config from
a template at deploy time, substituting `TEST_DOMAIN` in — the domain
lives in exactly one place (`scripts/deploy.config`), never duplicated
into a committed file.

---

## 4. Configuration — Settable, Not Hardcoded

A single config file, `scripts/deploy.config` (git-ignored;
`scripts/deploy.config.example` checked in as the template — same
pattern this repo already uses for `server/.local_env.example`), holds
every environment-specific value the scripts below need:

```bash
# scripts/deploy.config.example
TEST_SERVICE_NAME=travel-itinerary-app-test
TEST_REGION=us-east5
TEST_HOSTING_SITE=travel-itinerary-app-test
TEST_DOMAIN=test.duerk.org         # required — see §2.4; the ONLY place this subdomain is defined
TEST_FIRESTORE_DATABASE_ID=travel-itinerary-app-test-database
TEST_RUNTIME_SERVICE_ACCOUNT_EMAIL=
TEST_AI_CAPTURE_BUCKET=

PROD_SERVICE_NAME=travel-itinerary-app
PROD_REGION=us-east5
PROD_HOSTING_SITE=travel-itinerary-app          # or "default"
PROD_DOMAIN=duerk.org
PROD_FIRESTORE_DATABASE_ID=travel-itinerary-app-database
PROD_RUNTIME_SERVICE_ACCOUNT_EMAIL=
PROD_AI_CAPTURE_BUCKET=

ARTIFACT_REGISTRY_REPO=            # see §2.1 — required (build-once/promote-by-digest is the confirmed design)
ROLLBACK_RETENTION_DAYS=7          # how long an old prod revision is kept before it's eligible for teardown
```

Every script in §5 sources this file and fails fast (with a clear
error) if a required key is blank for the operation it's about to
perform — no script should silently fall back to guessing an
environment's name. `TEST_DOMAIN` is treated as required (not optional)
now that it's a confirmed subdomain rather than a fallback-to-default
value — `deploy-test.sh` refuses to run if it's blank, rather than
silently deploying to an unmapped `*.web.app` URL.

### 4.1 Keeping the domain out of checked-in JSON

Firebase Hosting's config (`firebase.json`) is a static file — it has no
built-in notion of "read this domain from an env var." To honor
"configurable outside of code" for the CSP/rewrite config described in
§3's CSP note, add a small template:

```
scripts/firebase.hosting.test.template.json     # checked in; contains {{TEST_DOMAIN}} placeholders
```

`deploy-test.sh` (§5.2) renders this into the actual Hosting config used
for that deploy by substituting `TEST_DOMAIN` from `deploy.config` —
the rendered file is a build artifact, not a checked-in source file, so
the subdomain never needs to be hand-edited in two places (config and
JSON) or risk drifting between them. Production's `firebase.json`
remains as-is, untouched by this mechanism, since its domain is already
stable and doesn't need to move.

### 4.2 One-time manual setup (not scriptable generically)

Two steps require access to systems these scripts don't control, and
are one-time, not repeated per deploy:

1. **DNS record for `test.duerk.org`** — add it at the domain registrar,
   the same way `DEPLOYMENT-GCP-FIREBASE.md` §8 already documents for
   `duerk.org` itself (TXT record for ownership verification, then the
   A records Firebase Hosting provides for the new site).
2. **Add the custom domain in the Firebase console** for the
   `travel-itinerary-app-test` Hosting site, pointing at
   `test.duerk.org`, and wait for SSL certificate provisioning — same
   one-time flow as production's existing domain connection.

Once both are done, every subsequent `deploy-test.sh` run is fully
scripted with no further manual steps.

---

## 5. Deployment Lifecycle and Scripts

All scripts live in `scripts/`, alongside (and reusing pieces of) the
existing `deploy-api.sh` / `deploy-hosting.sh` / `deploy-firestore-indexes.sh`
— they are not a parallel deployment system, they're the existing one
parameterized by environment plus two new operations (cutover, rollback,
teardown) that don't exist today.

### 5.1 `scripts/build-release.sh` (new — supports §2.1)

Builds the app once: `npm run build` (server), `npm run export:web`
(app), then `gcloud builds submit --tag
<region>-docker.pkg.dev/<project>/<ARTIFACT_REGISTRY_REPO>/travel-itinerary-app:<git-sha>`.
Prints the resulting image digest and writes an immutable release
manifest:

```json
{
  "gitSha": "...",
  "backendImageDigest": "...",
  "frontendArtifact": "github-actions-artifact://<runId>/dist.tgz",
  "frontendSha256": "...",
  "firestoreIndexesSha256": "...",
  "builtAt": "..."
}
```

This is the one build step both `deploy-test.sh` and
`cutover-test-to-prod.sh` consume — nothing downstream ever rebuilds
from source. The frontend export is archived and addressed by checksum
for the same reason the backend is addressed by digest.

**Artifact Custody**: While GitHub Actions artifacts are the starting point, **Google Cloud Storage (GCS)** is the preferred long-term store for the frontend `dist.tgz` to ensure artifacts outlive the GitHub retention window (default 90 days), allowing rollbacks to older "golden" versions.

GitHub artifact retention is an explicit operational constraint, not an
implementation detail. `cutover-test-to-prod.sh` must fail before
touching production if the manifest's artifact has expired or cannot be
downloaded. If the team needs rollback to a version older than the
GitHub retention window, move frontend artifacts to GCS before relying
on that rollback window operationally.

### 5.2 `scripts/deploy-test.sh`

1. Run `build-release.sh` (or accept a pre-built digest via
   `--release-manifest`, for CI reuse).
2. `gcloud run deploy $TEST_SERVICE_NAME --image <digest> --region
   $TEST_REGION --service-account $TEST_RUNTIME_SERVICE_ACCOUNT_EMAIL
   ...` with env vars pointed at `TEST_FIRESTORE_DATABASE_ID`,
   `TEST_AI_CAPTURE_BUCKET`, test API keys (§2.3), and `WEB_URL=https://$TEST_DOMAIN`
   (i.e. `https://test.duerk.org`) for CORS, using the existing
   `WEB_URL` convention rather than a new variable.
3. Unpack the manifest's frontend artifact into the deploy workspace,
   verify its SHA-256, then render
   `scripts/firebase.hosting.test.template.json` → the actual
   Hosting config for this deploy, substituting `$TEST_DOMAIN` (§4.1),
   then `firebase deploy --only hosting:$TEST_HOSTING_SITE` using the
   rendered config (rewrites pointed at `$TEST_SERVICE_NAME`/`$TEST_REGION`).
4. Run `scripts/deploy-firestore-indexes.sh` against
   `$TEST_FIRESTORE_DATABASE_ID`.
5. Seed synthetic fixture data (reuse the existing
   `scripts/seed-dev-accounts.ts` / `scripts/create-test-accounts.ts`
   pattern, pointed at the test database) if the test database is
   freshly created or on request via `--reseed`.
6. Run `scripts/smoke-test.sh <test URL>` (§6.2) and fail loudly if it
   doesn't pass — a "successful" test deploy that isn't actually
   healthy defeats the purpose of having a test environment at all.

### 5.3 `scripts/deploy-prod.sh`

Formalizes the existing direct-deploy flow (today's `deploy-api.sh` +
`deploy-hosting.sh`) for cases that don't need the full test-then-cutover
ceremony — e.g. an emergency hotfix, or a config/secret-only change.
Same steps as §5.2 but targets `PROD_*` config and **does not** touch
the test environment. This path bypasses the safety of "validated in
test first," so it should be the exception, not the default way changes
reach production — document that expectation next to the script.

Operational guardrail: `deploy-prod.sh` requires `--reason`, prints a
clear warning that it bypasses test validation, and records the reason,
operator, git SHA/release manifest, and target service in the same
deployment audit trail as cutover (§5.4 step 9). A future CI wrapper may
enforce extra approval for this path, but the script itself should not
make a direct production deploy feel indistinguishable from normal
promotion.

Authorization guardrail: the script checks `github.actor` (the GitHub
Actions workflow's authenticated identity, per §1's resolved decision 2)
against an allowlist containing Bryan and Tristan before it proceeds.
This is deliberately a deployment-script check in addition to IAM
permissions, because the runbook's human authority rule should be
visible and testable in the deployment tooling itself. This check only
resolves inside a GitHub Actions run — production-affecting scripts are
not supported as bare local invocations (§1 decision 2's stated
consequence), so there is no `gcloud`-identity fallback path to keep in
sync with the GitHub allowlist.

### 5.4 `scripts/cutover-test-to-prod.sh` — the promotion

This is the operation that actually implements "code-only promotion":
production's Firestore database and public domain are never touched;
only which code is running behind them changes.

1. Determine the image digest currently deployed to
   `$TEST_SERVICE_NAME` (via `gcloud run services describe`) — refuse
   to proceed if `--release-manifest` isn't explicitly passed *or* its
   backend digest doesn't match what's live in test, so cutover can
   never silently promote something other than what was actually
   validated. Also verify the manifest's frontend checksum matches the
   artifact deployed to the test Hosting site, or stop before touching
   production.
2. Deploy that exact digest to `$PROD_SERVICE_NAME` as a **new
   revision with `--no-traffic`**, tagged (`--tag candidate`) so it's
   reachable at its own Cloud Run revision URL without receiving any
   production traffic yet.
3. Run `scripts/smoke-test.sh <candidate revision URL>` **against
   production's real database** — this is the one point in the whole
   pipeline where the new code touches live data, and it's read-mostly
   plus a small write against a dedicated **canary account** that
   exists permanently in production data for exactly this purpose
   (clearly named, excluded from user-facing analytics and from
   Chapter 15's Executive Dashboard numbers). If this fails, stop —
   nothing has been exposed to real user traffic yet. **The
   ingestion/parsing canary check runs through `TestAiProvider`, not a
   real provider key** (§1 decision 3) — deterministic and free of
   per-cutover vendor spend; it verifies the deployed candidate's
   ingestion pipeline is correctly wired against production's real
   database, not that the real provider adapters work end-to-end (that's
   the provider contract suite's job, exercised separately in CI against
   real credentials).
4. **Important correction: production runs on Firestore, which has no
   versioned migration-file system at all — this step's "migration"
   framing only applies if this app is ever run against the Postgres
   adapter, not to the Firestore-backed production this chapter
   describes.** `server/src/migrations/runner.ts`'s `schema_migrations`
   ledger and `INGESTION_MIGRATIONS_ON_BOOT` are wired into
   `db.postgres.ts::initDb()` only — verified directly: `db.firebase.ts`'s
   `initDb()` has no call to `runMigrations` anywhere; Firestore, being
   schemaless, doesn't need one. What this codebase actually does
   instead for Firestore is **idempotent seed/backfill blocks inline in
   `db.firebase.ts::initDb()`** (e.g. "seed tiers (skip if already
   present)," "seed features (skip if already present)" — plain
   read-check-then-write code, not a tracked, ordered migration list).
   This is a materially different risk profile than what step 4
   originally described, and needs its own discipline rather than
   inheriting SQL-migration assumptions:
   - There's no `DROP COLUMN`/`DROP TABLE` equivalent to forbid (§9.4's
     lint doesn't apply to Firestore at all), but there *is* an
     equivalent risk: application code added in the candidate revision
     that reads a new field and assumes it's always present, when
     existing documents predate that field and no backfill wrote a
     default into them. The additive/backward-compatible rule in §6
     still applies — it just means "new code must tolerate a missing
     field with a sane default," not "don't drop a SQL column."
   - Any one-off Firestore backfill (analogous to a migration) is
     ordinary application code, run manually or via a script the team
     writes per-need — it is **not** tracked in a ledger the way SQL
     migrations are, so this chapter should require whoever writes a
     backfill to document, next to it, when it's safe to consider "done"
     and safe to remove the backward-compatible fallback it was there to
     support (the same expand/contract spirit as §6, applied without the
     tooling that makes it automatic for SQL). Chapter 12's schema
     versioning discipline is the right place to formalize this if it
     hasn't been already — flagging for cross-check against that
     chapter's actual content, since this review didn't re-read Chapter
     12 in full.
   - Firestore index changes (`firestore.indexes.json` /
     `deploy-firestore-indexes.sh`, already covered in §6) remain the
     one part of "schema evolution" for Firestore that *does* have a
     file-based, deploy-time mechanism — keep that discipline as-is.
5. Shift 100% of `$PROD_SERVICE_NAME` traffic to the new revision
   (`gcloud run services update-traffic ... --to-revisions
   <new>=100`). The previous revision is **not deleted** — it continues
   to exist at 0% traffic, which is what makes §5.6 possible.
6. Deploy the same validated frontend artifact from the release manifest to
   `$PROD_HOSTING_SITE`. Firebase Hosting keeps its own release history
   natively (visible in the Firebase console, rollback-capable via
   `firebase hosting:rollback` with no custom scripting needed) — this
   chapter doesn't need to build a parallel mechanism for the frontend
   the way it does for Cloud Run revisions.
7. Run `scripts/smoke-test.sh <production URL>` one more time,
   post-cutover, against the real public domain.
8. Delete every record the step-3 canary write created (trip,
   itinerary, expense, etc. rows scoped to the canary account's fixed
   ID) — run unconditionally, regardless of whether step 7 passed, so
   the canary account's data footprint never grows across cutovers (§6).
   Log success/failure but never let this step block or roll back the
   cutover itself.
9. Record the cutover (previous revision name, new revision name,
   image digest, timestamp, operator) to the existing `audit_log`
   table via a small admin-authenticated API call — this is a
   production change and belongs in the same audit trail as every
   other privileged action in this plan (Chapter 7 §11).

Optional flag: `--staged 10,50,100` shifts traffic in steps with a pause
between each (Cloud Run supports this natively via repeated
`update-traffic` calls) for teams that want a canary-style rollout
without committing to the full A/B infrastructure in Chapter 15 — off
by default, since the agreed design (§ decisions table) is immediate
code-only promotion, not gradual canarying. Owner decision: keep
immediate 100% cutover as the default for now; revisit staged default
when traffic volume or incident history justifies the extra operational
steps.

### 5.5 `scripts/rollback.sh` (Unified)

The necessary companion to "keep old production as a rollback net." This script provides a **unified rollback plane**: it reverts *both* the Cloud Run revision and the Firebase Hosting version in a single atomic-feeling operation. This prevents "Version Mismatch" errors where a new frontend tries to call a rolled-back API.

1. Shifts 100% of `$PROD_SERVICE_NAME` traffic back to the previous revision (`gcloud run services update-traffic ... --to-revisions <previous>=100`).
2. **Deploy the frontend artifact from that previous revision's own
   release manifest — do not call bare `firebase hosting:rollback`.**
   `firebase hosting:rollback`'s default behavior reverts Hosting by
   exactly one release, with no awareness of which backend revision it
   was actually paired with. If a `deploy-prod.sh` bypass deploy (§5.3)
   happened between the last cutover and this rollback — a real
   possibility, since that path exists specifically for emergency
   hotfixes — "one step back" on Hosting and "the previous tagged
   revision" on Cloud Run could resolve to two artifacts that were never
   actually deployed together, recreating the exact version-mismatch
   risk this unified script exists to prevent. Instead: look up the
   release manifest (§5.1) associated with the Cloud Run revision being
   rolled back to, unpack and verify its frontend artifact's checksum
   (the same step `deploy-test.sh`/`cutover-test-to-prod.sh` already
   perform), and `firebase deploy --only hosting:$PROD_HOSTING_SITE`
   that specific artifact explicitly. This is more verifiable than the
   generic rollback command and reuses machinery this chapter already
   built (§5.1's manifest, §5.4 step 1's checksum verification) rather
   than trusting Firebase Hosting's own release-history pointer to have
   stayed in sync with a separate Cloud Run revision history it has no
   knowledge of.
3. Validates the health of the restored pair via `smoke-test.sh`.

### 5.6 `scripts/teardown-old-production.sh`

Explicit, separate, confirmation-gated. Lists Cloud Run revisions for
`$PROD_SERVICE_NAME` older than `$ROLLBACK_RETENTION_DAYS` and
currently receiving 0% traffic; requires typed confirmation before
deleting them (`gcloud run revisions delete`). **Refuses to delete any
revision currently receiving nonzero traffic**, as a hard safety check —
this is the one script in this chapter where a mistake is genuinely
hard to undo, so it gets the most friction by design, consistent with
this project's general stance on destructive operations.

---

## 6. Data Integrity and Migration Discipline

- Because cutover is code-only (§5.4) and production's database is
  never swapped, "retaining production data integrity" reduces to one
  concrete rule: **any schema change must be additive and backward-
  compatible with the previous revision for the entire rollback
  window** (`ROLLBACK_RETENTION_DAYS`). This is the standard
  expand/contract migration pattern: add new fields/collections without
  removing or repurposing old ones at cutover time; only perform a
  "contract" step (removing the now-unused old shape) after
  `teardown-old-production.sh` has actually run and the rollback window
  has closed. This directly extends the backward-compatibility
  discipline already established for capture-schema versioning
  (Chapter 12 §6) to database schema changes specifically.
- Firestore index changes (`deploy-firestore-indexes.sh`) are applied to
  the **test** database first as part of `deploy-test.sh` (§5.2 step
  4), and to **production** as an explicit pre-cutover step, run and
  verified independently of `cutover-test-to-prod.sh` itself — index
  builds can take time and shouldn't be discovered as a blocker in the
  middle of a promotion.
- The **canary account** (§5.4 step 3) is a permanent, clearly-labeled
  fixture in production data. It must have an **`is_internal_canary: true`** flag in the `users` table.
- **Canary Safe Mode**: Application middleware must intercept any side-effect-heavy actions (e.g., sending real emails, triggering Stripe charges, or Push notifications) for accounts with this flag, redirecting them to a mock or log-only sink. This ensures a production smoke test never leaks into external customer-facing systems.
- Every cutover's smoke test writes new records under
  this account (§5.4 step 3's "small write"), and left alone this grows
  without bound across the lifetime of the project. Add a cleanup
  step to `cutover-test-to-prod.sh`, run immediately after step 7's
  post-cutover smoke test (success or failure — this must not depend on
  the cutover having gone well): delete every trip/itinerary/expense/etc.
  record created under the canary account by the write in step 3,
  identified by the canary account's fixed ID plus a `createdBy`/owner
  filter, leaving the account itself and its exclusion-list membership
  untouched. This keeps the account permanent while its *data footprint*
  stays flat regardless of how many cutovers have run — the same
  "accumulates across cutovers, must be reclaimed every time, not just
  once" principle as `teardown-old-production.sh` (§5.6) applied to a
  different kind of accumulated artifact. Record the cleanup's own
  success/failure via `logInfo`/`audit_log` like every other cutover
  step (§8.3) — a cleanup failure should be visible, not silently
  skipped, even though it must not block or roll back the cutover
  itself (the smoke test already passed; data hygiene is a
  best-effort follow-up, not a cutover gate).

---

## 7. AI-Platform-Specific Consequences (Chapters 1–15)

- **Cost isolation:** test's separate Firestore database (§2.2)
  automatically isolates `ai_provider_config`, `admin_settings`,
  `api_cost_counters`, and any Chapter 15 `ai_experiments` /
  `ai_recommendations` rows from production's. Combined with separate,
  low-budget vendor API keys (§2.3), a runaway loop in test cannot
  exhaust production's shadow-parsing budget or trip production's rate
  limiters.
- **Capture isolation:** test must write to its own AI capture bucket
  or an unambiguously separate prefix (§3 table) — never production's,
  even accidentally. Add this as an explicit assertion in
  `deploy-test.sh`'s startup smoke test (§6.2): confirm the deployed
  test service's resolved `AI_CAPTURE_BUCKET` env var does not match
  production's before considering the deploy healthy.
- **Experiments (Chapter 15 §3) and the recommendation engine (§4) run
  per-environment** — an experiment created in test is invisible to
  production and vice versa, since `ai_experiments` lives in each
  environment's own database. This is a feature, not a gap: it means
  test can be used to validate the experiment/recommendation machinery
  itself (e.g. does the circuit breaker actually pause a deliberately-
  broken `TestAiProvider` variant) without any risk to real experiments
  running in production.
- **Executive Dashboard (Chapter 15 §5.3) numbers must never blend
  environments** — the dashboard's data-access layer should read from
  whichever database the running service is bound to, with no
  cross-environment aggregation. This falls out naturally from the
  isolation above as long as no future code path hardcodes a
  cross-environment query "for convenience."

---

## 8. Cross-Cutting Qualities

### 8.1 Performance

None of this affects request-path latency — cutover is a traffic-routing
operation at the infrastructure layer (Cloud Run's own traffic-split
mechanism), not application code in the hot path. The one place
performance matters is **cutover duration**: steps 5.4.1–5.4.7 should
complete in low single-digit minutes so a bad deploy's blast-radius
window is short; if the post-deploy smoke suite (§6.2) is slow, that
directly extends how long a broken candidate could theoretically be
one command away from 100% traffic.

### 8.2 Scalability

Test and production are independently scaled Cloud Run services (each
scales to zero/up on its own), so test traffic (however heavy during a
QA push) can never contend with production's resources — they share
nothing at the compute layer. The one shared resource to watch is GCP
project-level API quotas (Cloud Build concurrent builds, Firestore
per-project limits) if both environments are very active simultaneously
— unlikely to matter at this project's scale, but worth knowing if a
separate GCP project (§2.2's alternative) is ever adopted, since that
would remove even this shared-quota consideration.

### 8.3 Serviceability

- Every cutover, rollback, and teardown action is logged via `logInfo`
  and written to `audit_log` (§5.4 step 9) — an incident review should
  never require reconstructing "what was live when" from Cloud Run
  console history alone.
- `scripts/current-state.sh` (new, small): prints, for both
  environments, the currently-serving revision, its image digest and
  git SHA, traffic split, and age — the single command an on-call
  engineer runs first when asked "what's actually live right now."
- Alerts (Chapter 11 §8) should include a **post-cutover elevated-error-rate
  watch**: for a configurable window after any traffic shift (default
  30 minutes), lower the alert threshold for the production service so
  a regression that the smoke suite missed is caught fast — this is
  cheap to add given the alerting pattern already exists.

### 8.4 Security

- `teardown-old-production.sh` and `cutover-test-to-prod.sh` are the two
  highest-blast-radius scripts in this chapter and must require the
  same human-in-the-loop confirmation discipline as any other
  destructive/production-affecting action in this project — no
  `--yes`/`--force` flag that silently skips confirmation in a
  non-interactive context without an explicit, separately-reviewed CI
  gate.
- Test environment's runtime service account (§3 table) is scoped
  (least privilege) to only test's Firestore database, test bucket, and
  test secrets — verified as part of the IAM setup script, not left
  implicit. A compromised or buggy test deployment must not be a path
  to production credentials.
- Test API keys (§2.3) and test `AUTH_SECRET` must differ from
  production's — a leak of test secrets (lower-stakes environment,
  potentially broader internal access) must never also compromise
  production.
- The canary account (§6) is a real account in production and must be
  excluded from any data export, third-party integration, or user-facing
  feature (e.g. it shouldn't appear in another user's "following"
  suggestions) — treat its exclusion list as something reviewed
  whenever a new user-facing feature touches "all users."

### 8.5 Maintainability

- One config file (§4) is the single source of truth for
  environment-specific values — no environment name, region, or bucket
  should ever be duplicated as a literal string across multiple
  scripts. This is the same "one place, versioned, no duplication"
  discipline already applied to the AI platform's own config (Chapter 3
  §5, Chapter 12).
- `deploy-test.sh` and `deploy-prod.sh` share a common
  `scripts/lib/deploy-common.sh` for the parts that are genuinely
  identical between environments (env-file parsing, secret mapping —
  i.e., today's `deploy-api.sh` logic), parameterized by the `TEST_*`/
  `PROD_*` values rather than forked into two divergent copies of the
  same script.

### 8.6 Usability

- `scripts/deploy-test.sh` and friends print a clear, colorized summary
  at the end: environment, service, revision, image digest, URL,
  smoke-test result — an operator should never have to grep script
  output to answer "did this work and where do I look at it."
- `cutover-test-to-prod.sh` and `teardown-old-production.sh` both
  support a `--dry-run` flag that prints every command they would run
  (including the exact `gcloud`/`firebase` invocations) without
  executing anything — this is what makes it safe to actually test
  these scripts (§9.5) and safe for a nervous operator to sanity-check
  before committing.

---

## 9. Comprehensive Test Plan for This Deployment Feature

| # | Test | What it proves | Owning script/mechanism |
|---|---|---|---|
| 9.1 | Pre-deploy validation gate | `npm run validate:app` + `npm run validate:server` (typecheck, unit tests) pass before any deploy is attempted — reused as-is, not re-invented | existing `npm run validate:*`, invoked at the top of `deploy-test.sh`/`deploy-prod.sh` |
| 9.2 | Post-deploy smoke suite | Health endpoint returns 200; a synthetic login succeeds; one itinerary-generation round trip (via the AI platform's `TestAiProvider` or a capped real key) returns a valid result; one parsing round trip against a fixture email/PDF succeeds; Socket.IO connects | `scripts/smoke-test.sh <base URL>`, run after every deploy and after cutover |
| 9.3 | Environment isolation assertion | The deployed service's resolved Firestore database ID and AI capture bucket do not match the *other* environment's configured values | added assertion inside `smoke-test.sh`, environment-aware |
| 9.4 | Migration additivity check | **SQL-migration path** (only relevant if a Postgres-backed environment is ever used): no migration file staged for a prod-bound deploy contains a destructive operation (`DROP COLUMN`, `DROP TABLE`, a narrowing type change) unless explicitly flagged as a "contract phase" migration. **Firestore path** (production today, §5.4 step 4): no new code path added in this deploy reads a field without a default/fallback for documents that predate that field — since there's no migration file to lint against for Firestore, this is a code-review checklist item, not an automatable static check, unless/until this codebase adopts a tracked Firestore backfill-ledger pattern | SQL: small lint step over new migration files, run in CI and before `deploy-prod.sh`. Firestore: PR review checklist item until a better mechanism exists |
| 9.4a | Canary Safe Mode interception | An action that would normally send a real email, trigger a Stripe charge, or send a push notification is redirected to a mock/log-only sink when performed by the `is_internal_canary` account, and behaves normally for every other account | integration test asserting the relevant middleware short-circuits for a fixture user with `is_internal_canary: true`, covering each side-effect category (email, Stripe, push) individually — this must exist and pass before the production canary write (§5.4 step 3) is ever exercised for real, since it's the control that keeps that write from leaking into external systems |
| 9.5 | Cutover dry-run | `cutover-test-to-prod.sh --dry-run` against a real test/prod pair produces the exact command sequence expected, with zero side effects | manual/CI exercise of the `--dry-run` flag from §8.6 |
| 9.6 | Candidate-revision smoke test before traffic shift | The tagged, `--no-traffic` candidate revision (§5.4 step 2–3) passes the full smoke suite against production's real database *before* any user traffic reaches it | `smoke-test.sh` against the revision-tagged URL, gating step 5 of `cutover-test-to-prod.sh` |
| 9.7 | Rollback drill | `rollback.sh` restores 100% API traffic to the previous Cloud Run revision and rolls Firebase Hosting back to the paired frontend version within a defined time budget | run as a periodic (e.g. quarterly) game-day exercise against test's own two-revision setup first, then verified available in production |
| 9.7a | Rollback pairing correctness after a bypass deploy | Simulate cutover N, then a `deploy-prod.sh` bypass deploy N.5, then roll back — `rollback.sh` must deploy N's manifest-paired frontend (not "one Hosting release back," which would resolve to N.5's frontend) alongside N's Cloud Run revision | fixture test asserting the frontend artifact deployed by `rollback.sh` matches the target revision's own release manifest, not whatever Firebase Hosting's release history considers "previous" |
| 9.8 | Regression/golden-fixture suite against the live candidate | Chapter 10's golden-fixture regression suite runs against the tagged candidate revision's URL, not just in CI against a local build — closes the gap between "tests passed pre-merge" and "this specific deployed artifact behaves correctly" | new CI job invoked from `cutover-test-to-prod.sh`, blocking before traffic shift |
| 9.9 | Teardown safety check | `teardown-old-production.sh` refuses to delete a revision currently receiving nonzero traffic, and refuses to run without explicit typed confirmation | unit-testable against a mocked `gcloud run revisions list` response; also exercised via `--dry-run` |
| 9.10 | Secret/config divergence check | Test and production `AUTH_SECRET`, vendor API keys, and `AI_HASH_SALT` are confirmed different values before a deploy is considered complete | assertion in `deploy-test.sh` comparing (hashed, never raw) secret fingerprints between the two Secret Manager entries |
| 9.11 | Post-cutover monitoring window | The elevated-error-rate watch (§8.3) is confirmed to actually tighten the alert threshold for the configured window and revert afterward | a scheduled-task/cron unit test against the alerting config, not a live production exercise |
| 9.12 | Canary-account exclusion check | The canary account never appears in Executive Dashboard aggregates (Chapter 15 §5.3), analytics rollups (Chapter 9), or any "all users" feature | a fixture-based test asserting the canary account's ID is filtered at the query layer, re-run whenever a new "all users" feature is added |
| 9.13 | Canary-account data cleanup | After N simulated cutovers against a test canary account, the count of records owned by that account returns to its baseline after each cutover's step 8 runs — i.e. data does not accumulate release over release | integration test against a disposable canary fixture, run in CI; also verified that step 8 runs (and logs a result) even when the step-7 smoke test it follows has failed |
| 9.14 | Release manifest integrity | A cutover fails if the manifest backend digest does not match the deployed test service or if the frontend artifact checksum does not match what was tested | mocked `gcloud run services describe` + fixture manifest + fixture artifact checksum test |
| 9.15 | Direct-prod bypass audit | `deploy-prod.sh` refuses to run without `--reason`, emits a bypass warning, and writes deployment audit evidence with that reason | script unit test around argument parsing and mocked audit write |
| 9.16 | App-owner authorization | Production-affecting scripts refuse to run when `github.actor` is not Bryan or Tristan, and refuse to run at all (distinct failure message) when `github.actor` is unset/unavailable (i.e. not running inside a GitHub Actions workflow) | mocked `github.actor` context in `deploy-prod.sh`, `cutover-test-to-prod.sh`, `rollback.sh`, and `teardown-old-production.sh` — including the "not in Actions context" case |
| 9.18 | Cutover duration SLO | End-to-end cutover (§5.4 steps 1–9) completes within 5 minutes; the golden-fixture regression gate (9.8) completes within 10 minutes, budgeted separately | timing assertion added to the CI job that runs cutover in a game-day/drill exercise, alerting if either budget is exceeded |
| 9.17 | Expired artifact refusal | Cutover fails before touching production when the GitHub Actions frontend artifact referenced by the release manifest has expired or cannot be downloaded | mocked GitHub artifact API response returning 404/expired |

---

## 10. Rollout

This chapter is additive infrastructure work and does not depend on
Chapters 1–15's AI platform being complete — it can be built in
parallel, though §7's AI-specific isolation checks (9.3, 9.10) only
become meaningful once `AI_CAPTURE_BUCKET` and vendor API keys exist as
configuration (Implementation Plan Phase 3–4). Suggested order: §5.1–5.3
(build pipeline + test deploy) first, since that alone gives the team a
real staging environment to develop against; §5.4–5.6 (cutover,
rollback, teardown) once the team has done a few manual promotions by
hand and has a concrete feel for what the scripts should automate.

## 11. Success Criteria

This chapter's scope is complete when: a developer can deploy any
commit to test with one command and get a working, fully isolated
environment; a promotion to production can be executed with one command
that provably deploys the exact artifact validated in test, with zero
production data or public URL disruption; a bad promotion can be
reverted with one command in under a minute without a rebuild; and the
previous production version is never deleted except through an explicit,
confirmed, audited action.

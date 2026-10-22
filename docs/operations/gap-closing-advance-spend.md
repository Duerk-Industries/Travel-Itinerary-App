# Advance spend reservation — 2026-10-21

Paid-work admission now charges a durable allowance before dispatch instead of relying on a read of settled spend. PostgreSQL and Firestore atomically check provider-month capacity, including concurrent outstanding allowances. Counters represent settled estimates plus conservative outstanding allowances; they are not an invoice total.

## Admission and settlement

- `reserveProviderSpendBatch` admits up to 64 provider attempts together, including their job/shadow scope mirrors. Every bucket must fit or none of the batch is charged. A quote cannot widen the configured provider ceiling. Zero monthly budgets stop paid work; null means no absolute monthly cap has been configured.
- Token-priced requests reserve a conservative text-input allowance (UTF-8 bytes plus framing) and their explicit maximum output. Requests without an output cap receive a 2,048-token cap. Operator model pricing in `api-limits.yaml` supplies the rates. Unpriced work is denied under a provider/job/shadow cap.
- A persisted dispatch claim permits each allowance to fund one provider attempt. Replaying admission is safe only before dispatch. A retry makes a new allowance and counts against the same durable job ceiling, including after process restart.
- Successful metered calls reconcile allowance to reported usage once. Gemini output accounting includes its reported thinking tokens ([provider documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en)).
- Timeouts, absent/invalid usage, crashes and uncertain dispatch retain the full allowance. There is no expiry refund. Only work known not to have dispatched can be released as unused; dispatch claims protect the provider and scope mirrors from that release.
- Reported overruns are counted in full and emit `api_spend.reservation_overrun`; future admission stops at the cap. Reconcile pricing/usage discrepancies before reopening capacity. Admission is based on configured estimates, not a guarantee against provider price changes or incorrect provider metering.
- The configured alert threshold (80% by default) emits a budget log/metric when settled spend plus reservations reaches it. Alerts are deduplicated per process/provider/window/limit; central log/metric collection handles alert delivery.
- Budget reset refuses unsettled work. An operator must reconcile uncertain provider attempts first; resetting counters is not an automatic recovery action.

The cost ledger uses a reservation ID for admitted attempts, so repeated settlement is idempotent and separate network attempts remain separately attributable even if a provider response ID is repeated. Existing non-reserved ledger callers retain their prior response-ID behavior. Job/shadow counters mirror the same cost and must not be added to provider totals as extra fees.

## Covered work

- Registry-backed AI providers and direct OpenAI chat calls reserve before network dispatch. The legacy Gemini flight parser now does the same and sends a bounded output cap.
- The import consensus parser reserves both model calls and their aggregate job spend before launching either. Insufficient or unavailable admission preserves static fields for individual review and prevents automatic assignment. Cheap structured/cache paths still avoid model work.
- Import-job scope counters cover subsequent attempts, shadow calls, parse-comparison storage and background GCS capture retries. The job ceiling is pinned to the job's creation month so a retry in a new month does not reset its allowance. Direct/manual extraction also receives a job scope.
- Shadow calls additionally reserve the existing `SHADOW_PARSE` monthly ceiling; the old post-hoc synthetic debit is removed to avoid double counting.
- Request-priced provider helpers reserve their configured flat request estimate before dispatch. Failed request-priced attempts remain conservatively charged. GCS captures/evaluations use `INGESTION_STORAGE` and reserve before each paid write, including retries. OCR currently runs locally through Tesseract and has no paid OCR API call.
- OpenAI audio has no duration metering in the current response contract. With an absolute OpenAI cap it requires a reviewed per-upload ceiling under `requestPricing.OPENAI_AUDIO_MAX`; otherwise it is held before dispatch. That value is a maximum per accepted upload, not a per-minute rate. Existing upload/duration bounds and the provider contract must justify it.

## Deployment and verification

Apply `server/migrations/20261028_api_spend_reservations.sql` before serving updated PostgreSQL workers (ordinary migration-on-boot also applies it). Firestore creates `api_spend_reservations` documents transactionally and needs no composite index. Keep historical monthly counters and uncertain reservations during deployment/restarts. Reservation records contain internal IDs, provider/window and monetary amounts, not prompts or credentials.

No production cap, pricing value, provider account or feature flag is changed by this implementation. Operators still need to choose absolute caps and maintain reviewed prices. Real PostgreSQL contention, live-provider billing reconciliation and production delivery of budget alerts remain deployment evidence.

Automated tests cover concurrent admission, multi-provider rollback, same-provider aggregate rejection, admission replay, settlement idempotency, dispatch claims, uncertain spend, scope mirrors, month isolation, zero caps, reset protection, actual overruns, network dispatch prevention and consensus fallback. Provider-neutral tests run against pg-mem and a Firestore emulator; pg-mem serializes its test transactions because it does not implement PostgreSQL row locks.


Verification: the 17-suite backend regression run passed 189 tests; final accounting changes then passed eight focused suites / 45 tests, with provider/registry/config checks also passing. Firestore passed 20 distinct admission, dispatch and consensus cases across focused runs (the final admission/dispatch rerun passed 19, plus the previously passing consensus case). Two admin UI suites passed seven tests. App/server TypeScript and `git diff --check` passed. The full repository suite and live PostgreSQL/provider billing checks were not run for this continuation.

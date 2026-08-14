# Itinerary improvement planning artifacts

`itinerary-cache-schema.md` is the **single canonical** production design and rollout plan (sections 16–24
cover storage/migration, limits/cost, feature flags, performance/observability, security/privacy,
maintainability, UX, and the test/rollout plan end to end — including how this design relates to the
existing prompt-based itinerary generator, see §0). `itinerary-cache-v2-improvement-plan.md` is an earlier
draft, now fully superseded and kept only for history — do not implement from it; it contains a few
now-corrected inaccuracies documented at the top of that file.

The JSON files are deliberately
small authoring fixtures, not a live corpus or production storage format. They contain known failures so
the audit demonstrates duplicate-category, group-span, duration, energy, nightlife, and cold-location gaps;
CI for the tool should assert the expected findings rather than treating these fixtures as promotable data.

The checked-in Python tool is credential-free and performs no network or production-storage operations:

```bash
python corpus_tools.py audit
python corpus_tools.py coverage
python corpus_tools.py plan --demand demand.json --json
python -m unittest -v test_corpus_tools.py
```

`promote` is a read-only preflight. Live authoring, verification, and promotion must run through the
feature-flagged, authenticated, metered, cost-recorded, audited, immutable-release server workflow described
in sections 16–24 of the design. Fixture verification references are opaque IDs with an `official:`,
`provider:`, or `partner:` prefix; raw URLs and model/self-attestation are rejected.

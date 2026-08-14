# Itinerary improvement planning artifacts

`itinerary-cache-schema.md` is the production design and rollout plan. The JSON files are deliberately
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
in sections 16–24 of the design.

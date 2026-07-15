# Itinerary Phase 3 design

Phase 3 injects deterministic attraction pods and endpoint logistics facts into p2, then runs mechanical
validation before p3. The LLM remains responsible for narrative selection only; code enforces meals,
density, arrival/recovery/departure limits, and verified closure evidence.

Admin prompt overrides remain supported. Missing new placeholders are safe: old overrides simply omit the
new context, while unresolved known placeholders are stripped before an API call. Prompt fingerprints in
Phase 4 include the active admin/default templates, pod block, logistics facts, and validator version, so
any Phase 3 change invalidates cached day fragments.


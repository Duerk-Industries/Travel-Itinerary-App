# GetYourGuide Phase 4 implementation

Phase 4 connects the existing itinerary planner to a bounded, deterministic
candidate pipeline. Candidate selection happens after itinerary activities,
catalog metadata, and travel legs are available, so affiliate eligibility
cannot influence the core itinerary order, descriptions, clustering, travel
times, or must-see coverage.

## Candidate inputs and limits

Each generated activity is normalized with its catalog destination, country and
coordinates (when verified), duration, start time, adjacent transfer minutes,
buffer time, budget tier, interest tags, must-see state, and booked state. The
account and trip preference contract supplies comfort, mobility, and interest
weights to the shared Phase 1 eligibility rules. Ambiguous destinations,
already-booked activities, infeasible transfer windows, and unsupported
activity types are rejected by those rules.

Selection is stable under input reordering and is bounded by the API-limit
configuration:

```yaml
caching:
  getYourGuide:
    maxAffiliateCandidatesPerDay: 2
    maxAffiliateLinksPerItinerary: 4
    descriptorConcurrency: 2
```

These are internal candidate/descriptor controls; they do not represent a
GetYourGuide partner quota. No partner API is called by Phase 4.

## Background enrichment and failure behavior

After the ordinary route response or asynchronous job is complete, the server
starts best-effort descriptor issuance with a maximum concurrency of four (the
default is two). The work is not awaited, does not write affiliate fields into
the itinerary cache, and cannot reorder or remove an activity. Abort signals
stop workers before they claim more work. Individual failures are isolated and
successful descriptors are retained for telemetry only; the existing Phase 2
descriptor endpoint remains the client source of truth.

The existing deep undefined-value sanitizer is applied at the itinerary cache
boundary, including nested arrays and objects. Optional affiliate data can
therefore never produce an invalid Firestore document.

Metrics use the general API/operations telemetry path (`selected`, `issued`,
and elapsed milliseconds). Affiliate revenue and commission remain separate
from provider/API cost accounting.

## Verification

`getYourGuideItineraryEnrichment.test.ts` covers catalog and transfer mapping,
preference-aware caps, deterministic selection, bounded concurrency, partial
failures, order preservation, and cancellation. The itinerary prompt-plan and
cache suites cover integration with generation and cache persistence,
including nested `undefined` values. Type checking and these focused suites
must pass before enabling the feature flag. Full-generation route latency is
unchanged because enrichment is scheduled only after the response/job result
has been persisted.

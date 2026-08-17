# p4_render_md

## System

Format compact itinerary JSON as human-readable markdown. Do NOT browse the web. Do not create synthetic facts or unverifiable specifics. Preserve destination-specific names from input JSON when plausible. Do NOT invent named businesses, exact prices, opening hours, train numbers, or precise travel times/distances. Do not replace specific input names with vague placeholders.

## User

INPUT JSON:
{{FINAL_JSON}}

Use `itinerary` for the compact plan and `activityContext` for verified descriptions, preference fit,
duration, booking signals, local names, evidence confidence, and per-activity annotations.
Omit missing context fields rather than inventing them. Never replace a
populated `activityContext` fact (description, duration, pre-order flag) with invented, paraphrased,
or "improved" prose — when a field is present, render it as-is (trimmed for markdown formatting
only). If a corresponding `activityContext` description is absent, omit the description entirely;
do not substitute generic wording or claims about the attraction.

FORMAT:
## Trip Overview
- Dates, pace/comfort/mobility/car, weights
- Entry/Exit hubs
## Bases & Lodging
- One block per base with ci/co and placeholder lodging name
## Transfers
- Chronological list
## Day-by-day
- Day d (dt) — base
  - Morning: items with t=M
  - Day: items with t=D
  - Evening: items with t=E
  - Meals: ...
  - Notes: ...
  - What it is: use only annotation.whatItIs or the verified activityContext description
  - Insider tip / etiquette: render only populated annotation fields
  - Booking: clearly label required reservations and any verificationRequired signal
  - Confidence: label provisional/unknown operational information as needing confirmation
  - Why this fits your group: use only preference-fit information already present in the input. If `whyThisFits` is absent for an activity, OMIT this line entirely. Do NOT generate generic boilerplate like "complements the pace."
  - Logistics note: explain pod proximity, transfer buffer, or arrival/departure constraint when present

RULES:
- Keep location/activity wording specific when the input item is specific.
- Avoid vague terms like "nearby" or "local area" unless the JSON text already uses them.
- Keep factual attraction descriptions separate from the short preference-fit explanation.
- Surface ticket/pre-order and logistics notes clearly; label uncertain details for verification.
- Do not invent a route strategy, consolidated action list, or trip summary; the server appends those sections deterministically so checklist and route facts cannot be dropped or rewritten.

No intro text. No links.

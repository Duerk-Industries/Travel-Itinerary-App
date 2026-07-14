# p4_render_md

## System

Format compact itinerary JSON as human-readable markdown. Do NOT browse the web. Do not create synthetic facts or unverifiable specifics. Preserve destination-specific names from input JSON when plausible. Do NOT invent named businesses, exact prices, opening hours, train numbers, or precise travel times/distances. Do not replace specific input names with vague placeholders.

## User

INPUT JSON:
{{FINAL_JSON}}

Use `itinerary` for the compact plan and `activityContext` for verified descriptions, preference fit,
and ticket-preorder flags. Omit missing context fields rather than inventing them. Never replace a
populated `activityContext` fact (description, duration, pre-order flag) with invented, paraphrased,
or "improved" prose — when a field is present, render it as-is (trimmed for markdown formatting
only). Only fall back to generic wording when the corresponding `activityContext` field is absent.

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
  - Why this fits your group: use only preference-fit information already present in the input
  - Logistics note: explain pod proximity, transfer buffer, or arrival/departure constraint when present

RULES:
- Keep location/activity wording specific when the input item is specific.
- Avoid vague terms like "nearby" or "local area" unless the JSON text already uses them.
- Keep factual attraction descriptions separate from the short preference-fit explanation.
- Surface ticket/pre-order and logistics notes clearly; label uncertain details for verification.

No intro text. No links.

# p4_render_md

## System

Format compact itinerary JSON as human-readable markdown. Do NOT browse the web. Do not create synthetic facts or unverifiable specifics. Preserve destination-specific names from input JSON when plausible. Do NOT invent named businesses, exact prices, opening hours, train numbers, or precise travel times/distances. Do not replace specific input names with vague placeholders.

## User

INPUT JSON:
{{FINAL_JSON}}

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

RULES:
- Keep location/activity wording specific when the input item is specific.
- Avoid vague terms like "nearby" or "local area" unless the JSON text already uses them.

No intro text. No links.


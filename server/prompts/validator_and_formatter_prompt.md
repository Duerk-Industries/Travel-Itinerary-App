# Prompt 3: Validator & Formatter

**System**:
You are a travel editor. Ensure logical flow and date continuity.
Output the final result in clean Markdown.

**User**:
Review and format this itinerary:
{{STEP2_JSON_OUTPUT}}

**Checklist**:
1. Are the entry/exit hubs clearly identified?
2. Is the "Rental Car Needed" section clearly separated with pickup/drop-off?
3. Format as:
   ## Trip Overview
   ## Logistics (Hubs, Transfers & Rental Car)
   ## Daily Itinerary
   ## Required Tours

**Constraint**: Use direct assertions. No intro text.
# Prompt 3: Validator & Formatter

> **Superseded — documentation only.** This combined prompt is not loaded by the application. Runtime
> validation and rendering are separate p0–p4 stages in `prompts/p3_validate.md` and
> `prompts/p4_render_md.md`, orchestrated by `itineraryPromptPlanService.ts`.

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

/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { parseInstructionMarkdown, type ItineraryInstructionPhase } from '../src/services/itineraryInstructionService';

// Parses the same .md files itineraryInstructionService.ts actually loads at runtime (the
// prompts/prompts/*.json siblings were an unused, stale duplicate of this content and were
// deleted — see server/prompts/README.md).
const readPrompt = (phase: ItineraryInstructionPhase, fileName: string): { sys: string; usr: string } => {
  const promptPath = path.join(__dirname, '..', 'prompts', 'prompts', fileName);
  return parseInstructionMarkdown(phase, fs.readFileSync(promptPath, 'utf8'));
};

describe('itinerary prompt specificity guardrails', () => {
  it('requests route rationale and uses only appropriately trusted activity-block facts', () => {
    const p1 = readPrompt('p1', 'p1_route.md');
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p1.usr).toContain('route rationale rt');
    expect(p1.usr).toContain('organizing thesis');
    expect(p1.usr).toContain('one concise reason this area/base fits the route');
    expect(p2.usr).toContain('ACTIVITY BLOCKS');
    expect(p2.usr).toContain('Never treat source="llm_draft" as verified operational evidence');
    expect(p3.usr).toContain('A verified closed day is a hard conflict and must be repaired');
    expect(p3.usr).toContain('Never promote source="llm_draft" into verified evidence');
  });

  it('enforces destination-specific activities and no generic events in p2/p3', () => {
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('Specificity requirement');
    expect(p2.usr).toContain('do NOT add generic event/festival suggestions');
    expect(p2.usr).toContain('Tours/day trips must name a specific place or route anchor');
    expect(p3.usr).toContain('remove generic festival/cultural-event suggestions');
    expect(p3.usr).toContain('must include a specific anchor');
  });

  it('warns against name-collision hallucinations (a place name matching the destination by coincidence)', () => {
    // Regression guard: a real trip generated "Explore the main historic district in
    // Norway" and had it enriched with a description of "Norway House, Manitoba,
    // Canada" — an unrelated place that only shares the word "Norway". Both stages
    // must explicitly instruct against trusting a name match alone.
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('Location verification');
    expect(p2.usr.toLowerCase()).toContain('norway house');
    expect(p3.usr).toContain('Location verification');
    expect(p3.usr.toLowerCase()).toContain('norway house');
  });

  it('warns against activity types that are geographically infeasible at the assigned location', () => {
    // Regression guard: real generations scheduled "Surf Lesson" in Monteverde (a Costa Rican
    // cloud-forest mountain town with no coast) and "Hot Springs" in Manuel Antonio (a Pacific
    // beach town with no geothermal activity) — a plausible place paired with an activity type
    // it doesn't actually support. Both stages must instruct against this, on top of the
    // server-side enforceGeographicActivityPlausibility check that catches what the model misses.
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('Activity-type feasibility');
    expect(p2.usr.toLowerCase()).toContain('monteverde');
    expect(p2.usr.toLowerCase()).toContain('manuel antonio');
    expect(p3.usr).toContain('Activity-type feasibility');
    expect(p3.usr.toLowerCase()).toContain('monteverde');
    expect(p3.usr.toLowerCase()).toContain('manuel antonio');
  });

  it('forbids arrival framing on any day other than the actual check-in day', () => {
    // Regression guard: a real 7-day, single-base Oslo trip had "Arrive in Oslo and
    // settle into the city rhythm" generated on Day 3 — well after the traveler had
    // already logged two full days there.
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('Arrival/settling-in framing');
    expect(p2.usr.toLowerCase()).toContain('day 1 of the whole trip');
    expect(p3.usr).toContain('Arrival/settling-in framing');
    expect(p3.usr.toLowerCase()).toContain('chunking artifact');
  });

  it('forbids silently combining a day trip with same-day base-city sightseeing', () => {
    // Regression guard: the same trip scheduled a Lillehammer day trip (a ~180km,
    // multi-hour round trip) on the same day as separate Oslo attractions (Akershus
    // Fortress, the Botanical Garden) — physically impossible in one day.
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('day trip or excursion away from the base city');
    expect(p2.usr.toLowerCase()).toContain('lillehammer');
    expect(p3.usr).toContain('Day-trip/base-city overlap');
    expect(p3.usr.toLowerCase()).toContain('lillehammer');
  });

  it('requires outdoor/photography items to respect the real daylight window when provided', () => {
    // Regression guard: a real winter Oslo trip scheduled a "panoramic walk" at
    // 09:00, right around actual sunrise (~09:15 in January) — the pipeline already
    // computes real sunrise/sunset/daylight-hours via climatology data and feeds it
    // into LOGISTICS FACTS, but nothing told the model to actually respect it.
    const p2 = readPrompt('p2', 'p2_days.md');
    expect(p2.usr.toLowerCase()).toContain('before sunrise');
    expect(p2.usr.toLowerCase()).toContain('daylight-hours figures given in logistics facts');
  });

  it('steers activity-type selection using the climate label already computed for the destination', () => {
    // Regression guard: a real winter Oslo trip recommended a 3-hour open-air harbor
    // cruise in January (cold, ~6.5h daylight) with no consideration of climate, even
    // though a climate label ("Cold Weather" etc.) is already computed and injected
    // into LOGISTICS FACTS — it just had zero behavioral rule attached to it.
    const p2 = readPrompt('p2', 'p2_days.md');
    expect(p2.usr).toContain('Climate-aware activity-type selection');
    expect(p2.usr).toContain('Cold Weather');
    expect(p2.usr.toLowerCase()).toContain('indoor alternative');
  });

  it('discourages repeating the same narrow attraction type even when the interest weight is high', () => {
    // Regression guard: a real 7-day Oslo trip scheduled 4 museum visits (Munch,
    // Norsk Folkemuseum, National Museum, Astrup Fearnley) despite the shortlist
    // having non-museum culture-tagged alternatives (a fortress, a sauna, a food
    // hall) — the existing weight-frequency rule (8) doesn't address type variety.
    const p2 = readPrompt('p2', 'p2_days.md');
    expect(p2.usr).toContain('Activity-type pacing diversity');
    expect(p2.usr.toLowerCase()).toContain('4 near-identical museum visits');
  });

  it('encourages naming free interior access for notable buildings instead of exterior-only framing', () => {
    // Regression guard: a real Oslo trip only ever scheduled "Oslo Opera House
    // exterior and harbor edge" — the free public lobby and roof were never
    // mentioned despite being well-known, realistically-accessible features.
    const p2 = readPrompt('p2', 'p2_days.md');
    expect(p2.usr).toContain('Notable-building depth');
    expect(p2.usr.toLowerCase()).toContain('oslo opera house');
    expect(p2.usr.toLowerCase()).toContain('exterior-only');
  });

  it('instructs the model to surface a holiday-awareness note rather than silently dropping it', () => {
    // Regression guard: a real trip ran Jan 1-7 (starting on New Year's Day) with
    // no note anywhere that hours might be reduced. buildHolidayAwarenessNote now
    // computes this deterministically and injects it into LOGISTICS FACTS, but the
    // model still needs to be told to actually surface it as a day-specific note.
    const p2 = readPrompt('p2', 'p2_days.md');
    expect(p2.usr.toLowerCase()).toContain('holiday');
    expect(p2.usr.toLowerCase()).toContain('do not silently drop it');
  });

  it('preserves specific names during markdown rendering', () => {
    const p4 = readPrompt('p4', 'p4_render_md.md');

    expect(p4.sys).toContain('Preserve destination-specific names from input JSON when plausible');
    expect(p4.sys).toContain('Do not replace specific input names with vague placeholders');
    expect(p4.usr).toContain('Avoid vague terms like "nearby" or "local area"');
  });
});

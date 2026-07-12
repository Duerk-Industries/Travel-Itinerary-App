import fs from 'node:fs';
import path from 'node:path';
import { applyTemplate } from '../src/services/itineraryPromptPlanService';
import { validateAndRepairItineraryStructure } from '../src/services/itineraryStructureValidator';
import { buildArrivalDepartureFacts } from '../src/services/arrivalDepartureRulesService';

describe('Phase 3 prompt and deterministic orchestration', () => {
  test('old admin templates remain valid and unresolved new placeholders never reach the model', () => {
    expect(applyTemplate('old template {{FINAL_JSON}}', { FINAL_JSON: '{}' })).toBe('old template {}');
    expect(applyTemplate('pods={{ATTRACTION_PODS}} logistics={{LOGISTICS_FACTS}}', {})).toBe('pods=none logistics=none');
  });

  test('repairs meals, density, recovery starts, and verified Sunday closures before p3', () => {
    const facts = buildArrivalDepartureFacts({ arrival: { date: '2026-08-01', localTime: '18:00', isLongHaul: true } });
    const itinerary = { dy: [
      { dt: '2026-08-01', me: ['bad'], ln: [], it: Array.from({ length: 6 }, (_, index) => ['M', 'O', `Item ${index}`] as [string, string, string]) },
      { dt: '2026-08-02', me: ['BQ', 'LC', 'DL'], ln: [], it: [['M', 'A', 'Sunday Museum'] as [string, string, string]] },
    ] };
    const result = validateAndRepairItineraryStructure({ itinerary, logisticsFacts: facts, closedWeekdaysByActivity: { 'sunday museum': [0] } });
    expect(result.itinerary.dy[0].me).toEqual(['BQ', 'LC', 'DL']);
    expect(result.itinerary.dy[0].it).toHaveLength(1);
    expect(result.itinerary.dy[1].it).toHaveLength(0);
    expect(result.issues.some((issue) => /verified closure/i.test(issue))).toBe(true);
  });

  test('checked-in p2 includes pods, logistics, golden hour, market lunch, group, and luxury rules', () => {
    const prompt = fs.readFileSync(path.resolve(__dirname, '../prompts/prompts/p2_days.md'), 'utf8');
    for (const expected of ['{{ATTRACTION_PODS}}', '{{LOGISTICS_FACTS}}', 'golden-hour', 'Food-market lunch', 'groups larger than 4', 'comfort=L']) expect(prompt).toContain(expected);
    const departure = buildArrivalDepartureFacts({ departure: { date: '2026-10-10', localTime: '12:00' }, departureBufferMinutes: 90 });
    expect(departure[0].latestActivityTime).toBe('10:30');
    expect(departure[0].note).toContain('90 minutes');
  });
});


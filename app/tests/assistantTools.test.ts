import type { Tour } from '../tabs/activities';
import {
  applyActionGuard,
  buildActionSystemPrompt,
  buildActionToolsPrompt,
  detectOutOfScopeCoercion,
  isInformationalQuestion,
  parseActionToolCall,
  rankActivitiesByNameSimilarity,
  type ParsedToolCall,
} from '../utils/assistantTools';

const makeTour = (overrides: Partial<Tour> = {}): Tour => ({
  id: 'tour-1',
  status: 'Needed',
  activityType: 'Tour',
  date: '2026-09-02',
  name: 'Museum Tour',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: '',
  bookedOn: '',
  reference: '',
  notes: '',
  paidBy: [],
  travelerIds: [],
  ...overrides,
});

describe('buildActionSystemPrompt / buildActionToolsPrompt', () => {
  it('states the out-of-scope rule applies even when the request is fully specified', () => {
    expect(buildActionSystemPrompt()).toMatch(/EVEN IF/);
  });

  it('lists the exact status enum values so the model can map phrasing onto them', () => {
    const prompt = buildActionToolsPrompt();
    expect(prompt).toMatch(/Needed/);
    expect(prompt).toMatch(/Booked/);
    expect(prompt).toMatch(/Cancelled/);
  });

  it('includes a fully-specified out-of-scope decline example for both flight and lodging', () => {
    const prompt = buildActionToolsPrompt();
    expect(prompt).toMatch(/every detail a flight needs is given/i);
    expect(prompt).toMatch(/lodging request, and there is no addLodging/i);
  });

  it('distinguishes a "how do I" informational question from a real action request', () => {
    // Regression test: manual testing found "How do I add a flight?" (purely
    // informational) getting answered with "Sure -- what date would you like
    // to do that?" -- the model pattern-matched on the word "add" and copied
    // the addActivity few-shot's clarifying-question response verbatim,
    // instead of recognizing "how do I" as a request for instructions. Fixed
    // with an explicit contrasting example, not just a stronger abstract rule
    // (an abstract-only version of this instruction was tried first and
    // wasn't enough on its own).
    expect(buildActionSystemPrompt()).toMatch(/how can I/i);
    expect(buildActionToolsPrompt()).toMatch(/how do i add a flight/i);
    expect(buildActionToolsPrompt()).toMatch(/never a\s*\n?\s*trigger for a tool call/i);
  });

  it('tells the model the few-shot examples are fictional and must not answer unrelated questions', () => {
    // Regression test: manual testing found the model regurgitating the
    // "Delta 88, ATL to ORD" few-shot example's invented details into an
    // unrelated "how do I add a flight" guide answer, because both prompts
    // are concatenated into one system message whenever actions are on
    // (useAssistantChat.ts). Both halves need their own explicit guard,
    // since either one alone wasn't enough to stop the leak in practice.
    expect(buildActionSystemPrompt()).toMatch(/fictional/i);
    expect(buildActionToolsPrompt()).toMatch(/fictional/i);
  });
});

describe('parseActionToolCall', () => {
  it('parses a single JSON tool call', () => {
    const result = parseActionToolCall('{"tool": "addActivity", "args": {"name": "Louvre tour", "date": "2026-04-12"}}');
    expect(result).toEqual([{ name: 'addActivity', args: { name: 'Louvre tour', date: '2026-04-12' }, raw: expect.any(String) }]);
  });

  it('parses an array of tool calls', () => {
    const result = parseActionToolCall(
      '[{"tool": "addActivity", "args": {"name": "A", "date": "2026-01-01"}}, {"tool": "updateItineraryStatus", "args": {"itemName": "B", "status": "Booked"}}]'
    );
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('addActivity');
    expect(result[1].name).toBe('updateItineraryStatus');
  });

  it('recovers two back-to-back JSON objects with no separator (a real observed small-model failure mode)', () => {
    const text =
      '{"tool": "addActivity", "args": {"name": "Cruise", "date": "2026-06-02"}}' +
      '{"tool": "addActivity", "args": {"name": "Hike", "date": "2026-06-03"}}';
    const result = parseActionToolCall(text);
    expect(result).toHaveLength(2);
    expect(result[0].args.name).toBe('Cruise');
    expect(result[1].args.name).toBe('Hike');
  });

  it('strips a markdown code fence around the JSON', () => {
    const result = parseActionToolCall('```json\n{"tool": "addActivity", "args": {"name": "A", "date": "2026-01-01"}}\n```');
    expect(result).toHaveLength(1);
  });

  it('treats an unrecognized tool name as no tool call', () => {
    expect(parseActionToolCall('{"tool": "addFlight", "args": {"passengerName": "Alex"}}')).toEqual([]);
  });

  it('treats unparseable text as no tool call', () => {
    expect(parseActionToolCall('Sure -- what date would you like to do that?')).toEqual([]);
  });

  it('treats empty/missing text as no tool call', () => {
    expect(parseActionToolCall('')).toEqual([]);
    expect(parseActionToolCall(null)).toEqual([]);
    expect(parseActionToolCall(undefined)).toEqual([]);
  });
});

describe('detectOutOfScopeCoercion / applyActionGuard', () => {
  const call = (args: Record<string, unknown>): ParsedToolCall => ({ name: 'addActivity', args, raw: '' });

  it('blocks a flight-shaped addActivity call', () => {
    expect(detectOutOfScopeCoercion(call({ name: 'United flight 245 from JFK to LAX' }))).toBe('flight');
  });

  it('blocks a lodging-shaped addActivity call', () => {
    expect(detectOutOfScopeCoercion(call({ name: 'Stay at Park Hyatt Kyoto', duration: '4 nights' }))).toBe('lodging');
  });

  it('does not block an innocuous activity', () => {
    expect(detectOutOfScopeCoercion(call({ name: 'Walking food tour in Rome' }))).toBeNull();
  });

  it('never flags updateItineraryStatus calls (the guard only applies to addActivity coercion)', () => {
    expect(detectOutOfScopeCoercion({ name: 'updateItineraryStatus', args: { itemName: 'flight to Tokyo' }, raw: '' })).toBeNull();
  });

  it('documents the known false-positive limitation rather than hiding it: a legitimately-named activity mentioning "hotel" is wrongly blocked', () => {
    expect(detectOutOfScopeCoercion(call({ name: 'Dinner at the Hotel Ritz' }))).toBe('lodging');
  });

  it('applyActionGuard splits kept vs. blocked calls', () => {
    const { kept, blocked } = applyActionGuard([
      call({ name: 'Walking tour of the Colosseum', date: '2026-04-12' }),
      call({ name: 'Book a hotel in Rome' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].args.name).toBe('Walking tour of the Colosseum');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].kind).toBe('lodging');
  });
});

describe('isInformationalQuestion', () => {
  it('matches "how do I" / "how can I" / "how to" phrasing, including with an action verb', () => {
    expect(isInformationalQuestion('How do I add a flight?')).toBe(true);
    expect(isInformationalQuestion('how can i book a hotel')).toBe(true);
    expect(isInformationalQuestion('How to add an activity')).toBe(true);
  });

  it('does not match a real action request', () => {
    expect(isInformationalQuestion('Add a flight for me on July 9th')).toBe(false);
    expect(isInformationalQuestion('Mark the harbor cruise as booked')).toBe(false);
  });
});

describe('rankActivitiesByNameSimilarity', () => {
  it('ranks an exact/substring match above unrelated names', () => {
    const activities = [
      makeTour({ id: 'a', name: 'Walking food tour in Rome' }),
      makeTour({ id: 'b', name: 'Eiffel Tower tour' }),
      makeTour({ id: 'c', name: 'Harbor cruise' }),
    ];
    const ranked = rankActivitiesByNameSimilarity('the Eiffel Tower tour', activities);
    expect(ranked[0].id).toBe('b');
  });

  it('is convenience-only ordering -- never throws or drops items for an unmatched name', () => {
    const activities = [makeTour({ id: 'a', name: 'Harbor cruise' })];
    const ranked = rankActivitiesByNameSimilarity('something completely unrelated', activities);
    expect(ranked).toHaveLength(1);
  });
});

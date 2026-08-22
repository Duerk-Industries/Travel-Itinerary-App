import { GUIDE_CORPUS, retrieveRelevantGuideEntries } from '../utils/assistantGuideCorpus';

describe('assistantGuideCorpus', () => {
  it('has unique ids across all entries', () => {
    const ids = GUIDE_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('retrieves the transfers entry for a flight-related question', () => {
    // Deliberately avoids the word "trip" so this doesn't tie with the
    // "trips" entry (which also matches on "trip") -- isolates the signal
    // to flight-specific keywords only.
    const results = retrieveRelevantGuideEntries('How do I add a flight departure time?');
    expect(results[0]?.id).toBe('transfers');
  });

  it('retrieves the expenses entry for a cost-splitting question', () => {
    const results = retrieveRelevantGuideEntries('Who owes what for the hotel?');
    // Both 'expenses' (who owes) and 'lodging' (hotel) are plausible matches;
    // expenses should rank first because "who owes" is a stronger, multi-word signal.
    expect(results[0]?.id).toBe('expenses');
  });

  it('returns an empty array for a query with no keyword overlap', () => {
    const results = retrieveRelevantGuideEntries('What is the airspeed velocity of an unladen swallow?');
    expect(results).toEqual([]);
  });

  it('returns an empty array for an empty/whitespace query', () => {
    expect(retrieveRelevantGuideEntries('')).toEqual([]);
    expect(retrieveRelevantGuideEntries('   ')).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const results = retrieveRelevantGuideEntries('trip flight hotel activity car rental expense', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('is case-insensitive', () => {
    const lower = retrieveRelevantGuideEntries('packing list for my suitcase');
    const upper = retrieveRelevantGuideEntries('PACKING LIST FOR MY SUITCASE');
    expect(upper.map((e) => e.id)).toEqual(lower.map((e) => e.id));
  });

  // Regression guard for a real hallucination observed in manual testing:
  // the model answered "click the Flights tab" -- a plausible-sounding name
  // for a travel app, but not this app's actual tab name. The corpus entry
  // now explicitly rules that guess out by name; keep it that way.
  it('explicitly names the Transfers tab and rules out "Flights tab" as a wrong guess', () => {
    const transfers = GUIDE_CORPUS.find((entry) => entry.id === 'transfers');
    expect(transfers?.content).toContain('Transfers');
    expect(transfers?.content.toLowerCase()).toContain('no separate "flights" tab');
  });
});

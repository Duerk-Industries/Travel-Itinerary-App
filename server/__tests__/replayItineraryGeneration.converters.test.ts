/// <reference types="jest" />
/// <reference types="node" />
import {
  resolveReplayRequest,
  wizardCliInputToServiceRequest,
  compactPromptRequestToServiceRequest,
  apiRouteBodyToServiceRequest,
  validateRequest,
  warnOnUnmatchedDestinationsAndAttractions,
} from '../scripts/replay-itinerary-generation';
import { WIZARD_CLI_INPUT_EXAMPLE } from '../scripts/wizardCliInputTypes';

jest.mock('../src/services/destinationAttractionAutocompleteService', () => ({
  searchDestinationLocationOptions: jest.fn(),
  searchAttractionOptionsForSelectedLocations: jest.fn(),
}));

const mockedAutocomplete = jest.requireMock('../src/services/destinationAttractionAutocompleteService') as {
  searchDestinationLocationOptions: jest.Mock;
  searchAttractionOptionsForSelectedLocations: jest.Mock;
};

describe('resolveReplayRequest — shape detection', () => {
  it('recognizes a plain service request', () => {
    const input = { destinations: ['Paris'], days: 3, budgetMin: 100, budgetMax: 500 };
    expect(resolveReplayRequest(input)).toEqual(input);
  });

  it('recognizes a wizard-shaped input even though it also has a destinations array', () => {
    const resolved = resolveReplayRequest(WIZARD_CLI_INPUT_EXAMPLE as any);
    expect(resolved.destinations).toEqual(WIZARD_CLI_INPUT_EXAMPLE.destinations);
    expect(resolved.tripIdSeed).toBe(WIZARD_CLI_INPUT_EXAMPLE.tripName);
    expect((resolved.promptTraits as any).tt.c).toBe('M');
    // tripName itself should not leak through as a request field the service doesn't expect
    expect((resolved as any).tripName).toBeUndefined();
  });

  it('recognizes an API route body shape', () => {
    const resolved = resolveReplayRequest({ locations: ['Rome'], days: 2, budgetMin: 0, budgetMax: 100 });
    expect(resolved.destinations).toEqual(['Rome']);
  });

  it('recognizes a compact promptRequest shape', () => {
    const resolved = resolveReplayRequest({
      $: 'req1',
      d: ['Tokyo'],
      dur: 5,
      budgetMin: 200,
      budgetMax: 900,
    } as any);
    expect(resolved.destinations).toEqual(['Tokyo']);
    expect(resolved.days).toBe(5);
  });
});

describe('wizardCliInputToServiceRequest', () => {
  it('maps the worked example into a service-request shape', () => {
    const mapped = wizardCliInputToServiceRequest(WIZARD_CLI_INPUT_EXAMPLE as any);
    expect(mapped.destinations).toEqual(['Boston', 'New York City']);
    expect(mapped.days).toBe(7);
    expect(mapped.budgetMin).toBe(1500);
    expect(mapped.budgetMax).toBe(4000);
    expect(mapped.departureAirport).toBe('CLE');
    expect(mapped.tripStartDate).toBe('2026-09-12');
    expect(mapped.tripEndDate).toBe('2026-09-19');
    expect((mapped.promptTraits as any).tt.p).toBe('B');
    expect((mapped.promptTraits as any).ut.i).toEqual(['museums', 'walking tours']);
    expect(mapped.mustSeeAttractions).toEqual(WIZARD_CLI_INPUT_EXAMPLE.mustSeeAttractions);
    expect(mapped.groupTraits).toEqual([]);
  });
});

describe('compactPromptRequestToServiceRequest / apiRouteBodyToServiceRequest', () => {
  it('still work as before (regression guard)', () => {
    const compact = compactPromptRequestToServiceRequest({ d: ['Lima'], dur: 4, budgetMax: 1000 }, {});
    expect(compact.destinations).toEqual(['Lima']);
    const apiBody = apiRouteBodyToServiceRequest({ country: 'Peru', days: 4, budgetMin: 0, budgetMax: 1000 });
    expect(apiBody.destinations).toEqual(['Peru']);
  });
});

describe('validateRequest', () => {
  it('throws when destinations is empty', () => {
    expect(() => validateRequest({ destinations: [], days: 1, budgetMin: 0, budgetMax: 100 })).toThrow();
  });

  it('passes for a valid request', () => {
    expect(() => validateRequest({ destinations: ['Paris'], days: 1, budgetMin: 0, budgetMax: 100 })).not.toThrow();
  });
});

describe('warnOnUnmatchedDestinationsAndAttractions', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedAutocomplete.searchDestinationLocationOptions.mockReset();
    mockedAutocomplete.searchAttractionOptionsForSelectedLocations.mockReset();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('does not warn when destinations and attractions confidently match', async () => {
    mockedAutocomplete.searchDestinationLocationOptions.mockResolvedValue([{ id: 'd1', sourceType: 'destination', name: 'Boston' }]);
    mockedAutocomplete.searchAttractionOptionsForSelectedLocations.mockResolvedValue([
      { id: 'a1', sourceType: 'attraction', name: 'Freedom Trail' },
    ]);

    await warnOnUnmatchedDestinationsAndAttractions({
      destinations: ['Boston'],
      mustSeeAttractions: ['Freedom Trail'],
    });

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('warns when a destination has no confident match', async () => {
    mockedAutocomplete.searchDestinationLocationOptions.mockResolvedValue([]);
    mockedAutocomplete.searchAttractionOptionsForSelectedLocations.mockResolvedValue([]);

    await warnOnUnmatchedDestinationsAndAttractions({ destinations: ['Nowhereville'], mustSeeAttractions: [] });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('no confident destination match for "Nowhereville"'));
  });

  it('warns when a must-see attraction has no confident match', async () => {
    mockedAutocomplete.searchDestinationLocationOptions.mockResolvedValue([{ id: 'd1', sourceType: 'destination', name: 'Boston' }]);
    mockedAutocomplete.searchAttractionOptionsForSelectedLocations.mockResolvedValue([]);

    await warnOnUnmatchedDestinationsAndAttractions({
      destinations: ['Boston'],
      mustSeeAttractions: [{ name: 'Made Up Place', destinationName: 'Boston' }],
    });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('no confident attraction match for "Made Up Place"'));
  });

  it('does not fail or mutate the request when nothing matches', async () => {
    mockedAutocomplete.searchDestinationLocationOptions.mockResolvedValue([]);
    mockedAutocomplete.searchAttractionOptionsForSelectedLocations.mockResolvedValue([]);
    const request = { destinations: ['Nowhereville'], mustSeeAttractions: ['Nothing Here'] };
    const snapshot = JSON.stringify(request);

    await expect(warnOnUnmatchedDestinationsAndAttractions(request)).resolves.toBeUndefined();
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});

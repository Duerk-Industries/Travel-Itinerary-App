/// <reference types="jest" />
/// <reference types="node" />
import { tripNameToFileSlug, WIZARD_CLI_INPUT_EXAMPLE } from '../scripts/wizardCliInputTypes';

describe('tripNameToFileSlug', () => {
  it('replaces whitespace runs with a single dash', () => {
    expect(tripNameToFileSlug('Boston and   New York')).toBe('Boston-and-New-York');
  });

  it('strips characters unsafe in filenames', () => {
    expect(tripNameToFileSlug("Bryan's Portugal Trip: Fall '26")).toBe('Bryans-Portugal-Trip-Fall-26');
  });

  it('collapses repeated dashes', () => {
    expect(tripNameToFileSlug('Trip -- Name')).toBe('Trip-Name');
  });

  it('preserves case', () => {
    expect(tripNameToFileSlug('CAPS and lower')).toBe('CAPS-and-lower');
  });

  it('falls back to "trip" for empty or all-unsafe-character input', () => {
    expect(tripNameToFileSlug('')).toBe('trip');
    expect(tripNameToFileSlug('   ')).toBe('trip');
    expect(tripNameToFileSlug('!!!')).toBe('trip');
  });

  it('truncates to 100 characters', () => {
    const longName = 'A'.repeat(150);
    expect(tripNameToFileSlug(longName).length).toBe(100);
  });
});

describe('WIZARD_CLI_INPUT_EXAMPLE', () => {
  it('has the required fields populated', () => {
    expect(WIZARD_CLI_INPUT_EXAMPLE.tripName).toBeTruthy();
    expect(WIZARD_CLI_INPUT_EXAMPLE.destinations.length).toBeGreaterThan(0);
    expect(WIZARD_CLI_INPUT_EXAMPLE.days).toBeGreaterThan(0);
    expect(WIZARD_CLI_INPUT_EXAMPLE.budgetMax).toBeGreaterThanOrEqual(WIZARD_CLI_INPUT_EXAMPLE.budgetMin);
  });

  it('includes both plain-string and destination-tagged must-see attractions', () => {
    const mustSee = WIZARD_CLI_INPUT_EXAMPLE.mustSeeAttractions ?? [];
    expect(mustSee.some((entry) => typeof entry === 'string')).toBe(true);
    expect(mustSee.some((entry) => typeof entry === 'object' && entry.destinationName)).toBe(true);
  });
});

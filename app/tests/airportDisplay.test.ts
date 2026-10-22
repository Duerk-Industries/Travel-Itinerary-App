import { airportDisplayForCode, formatAirportLabel } from '../utils/airportDisplay';

describe('airportDisplayForCode', () => {
  const airports = [{ name: 'Boston Logan International', city: 'Boston', iata_code: 'BOS' }];

  it('shows the full name for a code that came from a search, not the preloaded list', () => {
    expect(airportDisplayForCode('NRT', null, {}, airports)).toBe('NRT');
    expect(airportDisplayForCode('NRT', null, { NRT: 'Tokyo Narita (NRT)' }, airports)).toBe('Tokyo Narita (NRT)');
  });

  it('prefers an explicit label, then a remembered one, then the list, then the code', () => {
    expect(airportDisplayForCode('BOS', 'Logan, Boston (BOS)', { BOS: 'remembered' }, airports)).toBe('Logan, Boston (BOS)');
    expect(airportDisplayForCode('bos', null, { BOS: 'remembered' }, airports)).toBe('remembered');
    expect(airportDisplayForCode('BOS', null, {}, airports)).toBe('Boston (BOS)');
    expect(airportDisplayForCode('ZZZ', null, {}, airports)).toBe('ZZZ');
  });

  it('leaves free text alone and marks an empty value', () => {
    expect(airportDisplayForCode('Ueno Station', null, {}, airports)).toBe('Ueno Station');
    expect(airportDisplayForCode('', null, {}, airports)).toBe('-');
    expect(airportDisplayForCode(null, '  ', {}, airports)).toBe('-');
  });

  it('formats a label as city and code', () => {
    expect(formatAirportLabel({ name: 'X', city: 'Osaka', iata_code: 'KIX' })).toBe('Osaka (KIX)');
    expect(formatAirportLabel({ name: 'Local airfield' })).toBe('Local airfield');
  });
});

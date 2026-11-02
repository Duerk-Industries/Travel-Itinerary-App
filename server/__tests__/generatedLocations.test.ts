import { isPlaceholderLocation, repairGeneratedLocations } from '../src/utils/generatedLocations';

describe('generated locations (R3)', () => {
  it('treats blank and trip-name locations as placeholders, ignoring case and punctuation', () => {
    expect(isPlaceholderLocation('', 'UC Test Lisbon')).toBe(true);
    expect(isPlaceholderLocation('  ', 'UC Test Lisbon')).toBe(true);
    expect(isPlaceholderLocation('uc test, lisbon!', 'UC Test Lisbon')).toBe(true);
    expect(isPlaceholderLocation('Belém Tower', 'UC Test Lisbon')).toBe(false);
    expect(isPlaceholderLocation('Lisbon', 'UC Test Lisbon')).toBe(false);
  });

  it('repairs stops and lodgings whose location is the trip name, and leaves real places alone', () => {
    const result = repairGeneratedLocations(
      {
        activities: [
          { name: 'Belém Tower', startLocation: 'UC Test Lisbon' },
          { name: 'Alfama walk', startLocation: '' },
          { name: 'Time Out Market', startLocation: 'Av. 24 de Julho 49' },
        ],
        lodgings: [{ name: 'Hotel Avenida', address: 'UC Test Lisbon' }, { name: 'Pensão', address: 'Rua Augusta 10' }],
      },
      { tripName: 'UC Test Lisbon', destination: 'Lisbon, Portugal' }
    );
    expect(result.activities.map(a => a.startLocation)).toEqual(['Belém Tower, Lisbon, Portugal', 'Alfama walk, Lisbon, Portugal', 'Av. 24 de Julho 49']);
    expect(result.lodgings.map(l => l.address)).toEqual(['Hotel Avenida, Lisbon, Portugal', 'Rua Augusta 10']);
    expect(result.repaired).toBe(3);
    expect(result.activities.some(a => a.startLocation === 'UC Test Lisbon')).toBe(false);
  });

  it('ignores a destination that is itself the trip name, and does not repeat it when the name already contains it', () => {
    const named = repairGeneratedLocations({ activities: [{ name: 'Sintra Palace', startLocation: 'UC Test Lisbon' }], lodgings: [] }, { tripName: 'UC Test Lisbon', destination: 'UC Test Lisbon' });
    expect(named.activities[0].startLocation).toBe('Sintra Palace');
    const dup = repairGeneratedLocations({ activities: [{ name: 'Lisbon Cathedral', startLocation: '' }], lodgings: [] }, { tripName: 'Trip', destination: 'Lisbon' });
    expect(dup.activities[0].startLocation).toBe('Lisbon Cathedral');
  });

  it('does not touch an item it cannot name', () => {
    const result = repairGeneratedLocations({ activities: [{ startLocation: '' }], lodgings: [] }, { tripName: 'T', destination: 'Rome' });
    expect(result).toMatchObject({ repaired: 0, activities: [{ startLocation: '' }] });
  });
});

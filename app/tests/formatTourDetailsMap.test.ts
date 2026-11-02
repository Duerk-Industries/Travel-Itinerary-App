/// <reference types="jest" />
import { formatTourDetails } from '../utils/overviewBuilder';

describe('formatTourDetails start location', () => {
  const tour = { id: 'a', name: 'Christ the Redeemer', date: '2027-05-10', startLocation: ' Corcovado, Rio de Janeiro ' };

  it('opens the start location in maps when the itinerary can', () => {
    const open = jest.fn();
    const row = formatTourDetails(tour, open).find((item) => item.label === 'Start Location')!;
    expect(row.value).toBe('Corcovado, Rio de Janeiro');
    row.onPress!();
    expect(open).toHaveBeenCalledWith('Corcovado, Rio de Janeiro');
  });

  it('has no link without a location or a way to open it', () => {
    expect(formatTourDetails(tour).find((item) => item.label === 'Start Location')!.onPress).toBeUndefined();
    const empty = formatTourDetails({ ...tour, startLocation: '' }, jest.fn()).find((item) => item.label === 'Start Location')!;
    expect(empty.value).toBe('N/A');
    expect(empty.onPress).toBeUndefined();
  });
});

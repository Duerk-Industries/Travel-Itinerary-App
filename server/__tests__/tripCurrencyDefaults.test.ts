import { currencyForDestination, defaultTripCurrency } from '../src/services/tripCurrencyDefaults';
import { getDbAdapter } from '../src/db.providers';
jest.mock('../src/db.providers', () => ({ getDbAdapter: jest.fn() }));

describe('R2 destination currency defaults', () => {
  it.each([['Portugal', 'EUR'], ['Kyoto, Japan', 'JPY'], ['London, United Kingdom', 'GBP'], ['Canada', 'CAD'], ['Unknown destination', 'USD']])('%s defaults to %s', (destination, currency) => {
    expect(currencyForDestination(destination)).toBe(currency);
  });
  it('uses the first destination only', async () => {
    const getLocationsByIds = jest.fn().mockResolvedValue([{ name: 'Lisbon', address: 'Portugal' }]);
    (getDbAdapter as jest.Mock).mockReturnValue({ getLocationsByIds });
    expect(await defaultTripCurrency('u', ['portugal', 'japan'])).toBe('EUR');
    expect(getLocationsByIds).toHaveBeenCalledWith('u', ['portugal']);
  });
});

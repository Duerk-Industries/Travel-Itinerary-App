import { TRANSFER_TYPES, normalizeTransferType } from '../utils/transferTypes';
import { normalizeFlightFromApi } from '../tabs/transfers';

it('offers consolidated transfer types only', () => {
  expect(TRANSFER_TYPES).toEqual(['Flight', 'Public Transit', 'Private Transfer', 'Other']);
});
it.each(['Train', 'Bus', 'Ferry', 'Public Transit'])('normalizes %s to Public Transit', type => {
  expect(normalizeTransferType(type)).toBe('Public Transit');
  expect(normalizeFlightFromApi({ transfer_type: type }).transferType).toBe('Public Transit');
});
it.each(['Private', 'Private Transfer'])('normalizes %s to Private Transfer', type => {
  expect(normalizeFlightFromApi({ transferType: type }).transfer_type).toBe('Private Transfer');
});

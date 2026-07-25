import { normalizePackingLabel as canonical } from '../../packages/domain/src/packingListNormalize';
import { normalizePackingLabel as server } from '../src/utils/packingListNormalize';

describe('packing-list normalization', () => {
  it.each([
    ['  Universal   Travel Adapter ', 'universal travel adapter'],
    ['Socks (x2)', 'socks'],
    ['Café / Crème', 'café crème'],
    ['ＡＢＣ', 'abc'],
  ])('normalizes %s', (input, expected) => {
    expect(canonical(input)).toBe(expected);
    expect(server(input)).toBe(expected);
  });
});

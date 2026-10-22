import { searchesFor } from '../src/services/locateItemService';

describe('searchesFor', () => {
  it('keeps the full hotel address ahead of name-only fallbacks', () => {
    expect(searchesFor('2-6-7 Asakusa, Tokyo, Japan', 'Richmond Hotel', 'Japan', true, true)).toEqual([
      '2-6-7 Asakusa, Tokyo, Japan',
      'Richmond Hotel, 2-6-7 Asakusa, Tokyo, Japan',
      'Richmond Hotel, Tokyo, Japan',
    ]);
  });

  it('adds destination context to an incomplete comma-separated address', () => {
    expect(searchesFor('123 Main Street, Springfield', 'Hotel', 'USA', true)[0]).toBe('123 Main Street, Springfield, USA');
    expect(searchesFor('123 Main Street, London, UK', 'Hotel', 'Japan', true)[0]).toBe('123 Main Street, London, UK');
  });
  it('tries the address first, then the name with the address\'s place names but not its street or block numbers', () => {
    expect(searchesFor('Tokyo-to, Tokyo, Taito-ku Asakusa 2-6-7, Japan', 'Richmond Hotel Premier Asakusa International', 'Japan', true)).toEqual([
      'Tokyo-to, Tokyo, Taito-ku Asakusa 2-6-7, Japan',
      'Richmond Hotel Premier Asakusa International, Tokyo-to, Tokyo, Japan',
    ]);
  });

  it('drops repeated place names and falls back to the destination when the address has none', () => {
    expect(searchesFor('Ishikawa, Kanazawa, 12-37 Yasuechō, Kanazawa, Ishikawa, Japan', 'Hotel Kanazawa Zoushi', 'Japan', true)[1])
      .toBe('Hotel Kanazawa Zoushi, Ishikawa, Kanazawa, Japan');
    expect(searchesFor('1-2-3', 'Hotel Numbered', 'Japan', true)).toEqual(['1-2-3, Japan', 'Hotel Numbered, Japan']);
  });

  it('adds the destination to a bare name, and does not repeat a search that would be identical', () => {
    expect(searchesFor('Ameyoko', 'Ameyoko', 'Japan', true)).toEqual(['Ameyoko, Japan']);
    expect(searchesFor('Senso-ji', 'Asakusa Temple', 'Japan', true)).toEqual(['Senso-ji, Japan', 'Asakusa Temple, Japan']);
  });

  it('searches by address alone when a name search is not appropriate (car rentals)', () => {
    expect(searchesFor('Narita Airport', 'Toyota', 'Japan', false)).toEqual(['Narita Airport, Japan']);
  });

  it('leaves a name that already carries its own place alone', () => {
    expect(searchesFor('Some Street 5, Kyoto, Japan', 'Hotel Gion, Kyoto', 'Japan', true)[1]).toBe('Hotel Gion, Kyoto');
  });
});

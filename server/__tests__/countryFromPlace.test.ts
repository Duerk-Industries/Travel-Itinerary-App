import { countryCodeFromPlace } from '../src/utils/countryFromPlace';

describe('countryCodeFromPlace', () => {
  it('reads a country from a destination or the end of an address', () => {
    expect(countryCodeFromPlace('Japan')).toBe('jp');
    expect(countryCodeFromPlace('  japan ')).toBe('jp');
    expect(countryCodeFromPlace('Kyoto, Japan')).toBe('jp');
    expect(countryCodeFromPlace('Tokyo-to, Tokyo, Taito-ku Asakusa 2-6-7, Japan')).toBe('jp');
    expect(countryCodeFromPlace('Barcelona, Spain')).toBe('es');
    expect(countryCodeFromPlace('Paris, France')).toBe('fr');
    expect(countryCodeFromPlace('Portugal')).toBe('pt');
  });

  it('understands common alternative names', () => {
    expect(countryCodeFromPlace('New York, USA')).toBe('us');
    expect(countryCodeFromPlace('London, UK')).toBe('gb');
    expect(countryCodeFromPlace('Edinburgh, Scotland')).toBe('gb');
    expect(countryCodeFromPlace('Seoul, South Korea')).toBe('kr');
    expect(countryCodeFromPlace('Prague, Czech Republic')).toBe('cz');
  });

  it('gives no country (and so no restriction) when the text names none', () => {
    expect(countryCodeFromPlace('Kyoto')).toBeUndefined();
    expect(countryCodeFromPlace('Alps')).toBeUndefined();
    expect(countryCodeFromPlace('')).toBeUndefined();
    expect(countryCodeFromPlace(null)).toBeUndefined();
    expect(countryCodeFromPlace(undefined)).toBeUndefined();
  });

  it('does not mistake a city or region for a country', () => {
    expect(countryCodeFromPlace('Atlanta, Georgia')).toBeUndefined();
    expect(countryCodeFromPlace('Savannah, Georgia, USA')).toBe('us');
    expect(countryCodeFromPlace('Lebanon, Pennsylvania, USA')).toBe('us');
    expect(countryCodeFromPlace('Hiroshima Prefecture')).toBeUndefined();
  });
});

import { geoapifyAdapter } from '../src/services/geocoder/geoapifyAdapter';
import { GeocoderError } from '../src/services/geocoder';

const KEY = 'test-geoapify-key-123';
const reply = (body: unknown, init: { status?: number } = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200 });
const options = () => ({ language: 'en', signal: new AbortController().signal });

describe('Geoapify adapter', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.GEOAPIFY_API_KEY = KEY;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GEOAPIFY_API_KEY;
  });

  it('describes itself and the credit its terms require', () => {
    expect(geoapifyAdapter.id).toBe('geoapify');
    expect(geoapifyAdapter.displayName).toBe('Geoapify');
    expect(geoapifyAdapter.credit.text).toMatch(/Geoapify.*OpenStreetMap/);
    expect(geoapifyAdapter.credit.links).toEqual([{ label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' }]);
  });

  it('reports whether a key is configured without calling out', () => {
    expect(geoapifyAdapter.isConfigured()).toBe(true);
    delete process.env.GEOAPIFY_API_KEY;
    expect(geoapifyAdapter.isConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns coordinates, city and confidence, using the documented request', async () => {
    fetchMock.mockResolvedValue(reply({ results: [{ lon: 139.7966, lat: 35.7148, city: 'Taito City', country_code: 'jp', rank: { confidence: 0.92 } }] }));
    const found = await geoapifyAdapter.geocode('Asakusa 2-6-7, Taito, Tokyo, Japan', options());
    expect(found).toEqual({ lat: 35.7148, lng: 139.7966, geoCity: 'Taito City', confidence: 0.92, countryCode: 'jp' });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/search');
    expect(url.searchParams.get('text')).toBe('Asakusa 2-6-7, Taito, Tokyo, Japan');
    expect(url.searchParams.get('apiKey')).toBe(KEY);
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.has('filter')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error' }));
  });

  it('prefers a town or village when there is no city, accepts numeric strings, and tolerates missing confidence', async () => {
    fetchMock.mockResolvedValue(reply({ results: [{ lon: '10.5', lat: '45.25', village: 'Tsumago' }] }));
    expect(await geoapifyAdapter.geocode('Tsumago', options())).toEqual({ lat: 45.25, lng: 10.5, geoCity: 'Tsumago', confidence: null, countryCode: null });
  });

  it('restricts matches to a country when asked, and ignores a malformed code', async () => {
    fetchMock.mockImplementation(async () => reply({ results: [{ lon: 139.79, lat: 35.71, country_code: 'JP', rank: { confidence: 0.76 } }] }));
    const found = await geoapifyAdapter.geocode('Richmond Hotel Premier Asakusa International, Tokyo', { ...options(), countryCode: 'jp' });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('filter')).toBe('countrycode:jp');
    expect(found?.countryCode).toBe('jp');
    await geoapifyAdapter.geocode('x', { ...options(), countryCode: 'JPN' });
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has('filter')).toBe(false);
  });

  it('returns null when there is no result', async () => {
    fetchMock.mockResolvedValue(reply({ results: [] }));
    expect(await geoapifyAdapter.geocode('nowhere', options())).toBeNull();
  });

  it('refuses without a key, before any network call', async () => {
    delete process.env.GEOAPIFY_API_KEY;
    await expect(geoapifyAdapter.geocode('x', options())).rejects.toMatchObject({ code: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps provider failures to short codes', async () => {
    const failure = async (response: Response): Promise<string> => {
      fetchMock.mockResolvedValueOnce(response);
      const error = await geoapifyAdapter.geocode('a', options()).then(() => null, (caught: unknown) => caught);
      return error instanceof GeocoderError ? error.code : 'not-a-geocoder-error';
    };
    expect(await failure(reply('', { status: 429 }))).toBe('rate-limit');
    expect(await failure(reply('', { status: 500 }))).toBe('provider');
    expect(await failure(reply('not json'))).toBe('invalid-response');
    expect(await failure(reply({ nope: true }))).toBe('invalid-response');
    expect(await failure(reply({ results: [{ lon: 500, lat: 2 }] }))).toBe('invalid-response');
    expect(await failure(reply({ results: [{ lon: '', lat: '' }] }))).toBe('invalid-response');
    expect(await failure(reply(JSON.stringify({ results: [], pad: 'x'.repeat(70_000) })))).toBe('invalid-response');
  });

  it('never lets the API key out, even when the network error echoes the URL', async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for https://api.geoapify.com/v1/geocode/search?text=a&apiKey=${KEY}`));
    const error = await geoapifyAdapter.geocode('a', options()).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeocoderError);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect((error as Error).message).not.toContain(KEY);
    expect((error as GeocoderError).code).toBe('provider');
  });

  it('reports an abort as a timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(geoapifyAdapter.geocode('a', options())).rejects.toMatchObject({ code: 'timeout' });
  });
});

/**
 * The contract every geocoding provider implements. An adapter only talks to its provider: it builds the request,
 * authenticates, and turns the answer into a GeocoderResult. Everything that must be the same for every provider
 * (daily cap, query limits, timeout, confidence threshold, error normalization) lives in `geocodeAddress`
 * (./index.ts), so a new provider cannot forget it. To add one, implement this interface and `registerGeocoder` it.
 */

export type GeocoderFailureCode =
  | 'not-configured' | 'quota' | 'rate-limit' | 'timeout' | 'provider' | 'invalid-response' | 'invalid-query';

/** The only error type that leaves the geocoding layer. It carries a code, never a message that could echo a URL or key. */
export class GeocoderError extends Error {
  constructor(readonly code: GeocoderFailureCode) {
    super(code);
    this.name = 'GeocoderError';
  }
}

export type GeocoderResult = {
  lat: number;
  lng: number;
  geoCity: string | null;
  /** The provider's 0..1 match confidence, or null when it reports none. */
  confidence: number | null;
  /** Lowercase ISO 3166-1 alpha-2 country of the match, or null when the provider does not say. */
  countryCode: string | null;
  /** Spatial level of the result (building, amenity, street, city, etc.), when reported. */
  resultType?: string;
  /** Provider match level; a high confidence city match still isn't a hotel location. */
  matchType?: string;
};

/** What a provider requires to be shown wherever its results appear. */
export type GeocoderCredit = {
  /** Plain-text credit stored with, and returned alongside, every coordinate it produced. */
  text: string;
  /** Links the provider's terms require near the results (for example "Powered by ..."). */
  links: Array<{ label: string; url: string }>;
};

export type GeocodeOptions = {
  language: string;
  signal: AbortSignal;
  /** Restrict matches to this country (lowercase ISO alpha-2) when the provider can; adapters that cannot may ignore it. */
  countryCode?: string;
};

export interface GeocoderAdapter {
  /** Stable lowercase id, used for configuration (`GEOCODER_PROVIDER`), quotas and logs. */
  readonly id: string;
  /** Human name shown to users, for example in "sends each address to <name>". */
  readonly displayName: string;
  readonly credit: GeocoderCredit;
  /** True when every credential the provider needs is present. Must not call the network. */
  isConfigured(): boolean;
  /**
   * Looks up one query. Return null when there is no match. Throw GeocoderError for provider trouble.
   * Honor `signal` (the caller enforces the timeout). Never put a credential in a thrown message or a log.
   */
  geocode(query: string, options: GeocodeOptions): Promise<GeocoderResult | null>;
}

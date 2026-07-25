import {
  GETYOURGUIDE_API_KEY_FALLBACK_ENV,
  GETYOURGUIDE_API_BASE_URL_ENV,
  GETYOURGUIDE_API_CACHE_PERMISSION_ENV,
  GETYOURGUIDE_API_TOKEN_ENV,
  GETYOURGUIDE_FEATURE_FLAG,
  GETYOURGUIDE_PARTNER_ID_ENV,
  getGetYourGuidePartnerConfig,
  hasGetYourGuidePartnerConfiguration,
  isGetYourGuideFeatureEnabled,
} from '../src/config/getYourGuide';
import { getFeatureFlagSeeds } from '../src/config/featureFlags';

jest.mock('../src/db', () => ({
  getFeatureFlag: jest.fn(),
}));

const db = jest.requireMock('../src/db') as { getFeatureFlag: jest.Mock };

describe('GetYourGuide Phase 0 configuration', () => {
  const originalPartnerId = process.env[GETYOURGUIDE_PARTNER_ID_ENV];
  const originalToken = process.env[GETYOURGUIDE_API_TOKEN_ENV];
  const originalKey = process.env[GETYOURGUIDE_API_KEY_FALLBACK_ENV];
  const originalBaseUrl = process.env[GETYOURGUIDE_API_BASE_URL_ENV];
  const originalCachePermission = process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];

  beforeEach(() => {
    delete process.env[GETYOURGUIDE_PARTNER_ID_ENV];
    delete process.env[GETYOURGUIDE_API_TOKEN_ENV];
    delete process.env[GETYOURGUIDE_API_KEY_FALLBACK_ENV];
    delete process.env[GETYOURGUIDE_API_BASE_URL_ENV];
    delete process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];
    db.getFeatureFlag.mockReset();
  });

  afterAll(() => {
    if (originalPartnerId === undefined) delete process.env[GETYOURGUIDE_PARTNER_ID_ENV];
    else process.env[GETYOURGUIDE_PARTNER_ID_ENV] = originalPartnerId;
    if (originalToken === undefined) delete process.env[GETYOURGUIDE_API_TOKEN_ENV];
    else process.env[GETYOURGUIDE_API_TOKEN_ENV] = originalToken;
    if (originalKey === undefined) delete process.env[GETYOURGUIDE_API_KEY_FALLBACK_ENV];
    else process.env[GETYOURGUIDE_API_KEY_FALLBACK_ENV] = originalKey;
    if (originalBaseUrl === undefined) delete process.env[GETYOURGUIDE_API_BASE_URL_ENV];
    else process.env[GETYOURGUIDE_API_BASE_URL_ENV] = originalBaseUrl;
    if (originalCachePermission === undefined) delete process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];
    else process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV] = originalCachePermission;
  });

  it('fails closed when the partner ID is missing, even if the DB flag is enabled', async () => {
    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: true });

    expect(hasGetYourGuidePartnerConfiguration()).toBe(false);
    expect(await isGetYourGuideFeatureEnabled()).toBe(false);
    expect(db.getFeatureFlag).not.toHaveBeenCalled();
  });

  it('loads the optional feature seed from YAML as a boolean', () => {
    expect(getFeatureFlagSeeds()[GETYOURGUIDE_FEATURE_FLAG]).toEqual(expect.objectContaining({
      enabled: expect.any(Boolean),
    }));
  });

  it('requires the DB flag and server partner ID before enabling the optional feature', async () => {
    process.env[GETYOURGUIDE_PARTNER_ID_ENV] = 'phase0-test-partner';

    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: false });
    expect(await isGetYourGuideFeatureEnabled()).toBe(false);

    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: true });
    expect(await isGetYourGuideFeatureEnabled()).toBe(true);
  });

  it('reports API credential presence without returning the credential', () => {
    process.env[GETYOURGUIDE_PARTNER_ID_ENV] = 'phase0-test-partner';
    process.env[GETYOURGUIDE_API_TOKEN_ENV] = 'test-token';

    expect(getGetYourGuidePartnerConfig()).toEqual(expect.objectContaining({ partnerId: 'phase0-test-partner', hasApiToken: true, hasApiCachePermission: false }));
    expect(JSON.stringify(getGetYourGuidePartnerConfig())).not.toContain('test-token');

    delete process.env[GETYOURGUIDE_API_TOKEN_ENV];
    process.env[GETYOURGUIDE_API_KEY_FALLBACK_ENV] = 'fallback-test-key';
    expect(getGetYourGuidePartnerConfig().hasApiToken).toBe(true);
  });
});

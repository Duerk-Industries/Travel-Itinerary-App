import {
  createGetYourGuideDescriptor,
  getGetYourGuideTokenPayloadForTests,
  resolveGetYourGuideRedirect,
} from '../src/services/getYourGuideAffiliateService';
import { GETYOURGUIDE_FEATURE_FLAG, GETYOURGUIDE_PARTNER_ID_ENV, GETYOURGUIDE_ALLOWED_HOSTS_ENV } from '../src/config/getYourGuide';

jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn() }));
const db = jest.requireMock('../src/db') as { getFeatureFlag: jest.Mock };

const candidate = {
  id: 'activity-1',
  name: 'Louvre Museum Guided Tour',
  activityType: 'Tour',
  date: '2026-08-01',
  destination: { destination: 'Paris, France' },
  durationMinutes: 120,
  availableMinutes: 420,
  interestTags: ['culture'],
};

describe('GetYourGuide Phase 2 opaque affiliate descriptors', () => {
  const originalPartner = process.env[GETYOURGUIDE_PARTNER_ID_ENV];
  const originalHosts = process.env[GETYOURGUIDE_ALLOWED_HOSTS_ENV];

  beforeEach(() => {
    process.env[GETYOURGUIDE_PARTNER_ID_ENV] = 'phase2-test-partner';
    delete process.env[GETYOURGUIDE_ALLOWED_HOSTS_ENV];
    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: true });
  });

  afterAll(() => {
    if (originalPartner === undefined) delete process.env[GETYOURGUIDE_PARTNER_ID_ENV];
    else process.env[GETYOURGUIDE_PARTNER_ID_ENV] = originalPartner;
    if (originalHosts === undefined) delete process.env[GETYOURGUIDE_ALLOWED_HOSTS_ENV];
    else process.env[GETYOURGUIDE_ALLOWED_HOSTS_ENV] = originalHosts;
  });

  it('issues an encrypted, expiring descriptor without embedding activity text', async () => {
    const descriptor = await createGetYourGuideDescriptor({ candidate, targetUrl: 'https://www.getyourguide.com/destinations/paris/' });
    expect(descriptor).toEqual(expect.objectContaining({ provider: 'getyourguide', disclosureRequired: true }));
    expect(descriptor?.token).not.toContain('Louvre');
    expect(descriptor?.token).toMatch(/^g1\.[A-Za-z0-9_-]+\./);
    expect(getGetYourGuideTokenPayloadForTests(descriptor!.token)).toEqual(expect.objectContaining({ targetPath: '/destinations/paris/' }));
  });

  it('builds only an approved-host HTTPS URL and strips client query parameters', async () => {
    const descriptor = await createGetYourGuideDescriptor({ candidate, targetUrl: 'https://www.getyourguide.com/activities/paris/?q=secret&cmp=client' });
    const redirect = await resolveGetYourGuideRedirect(descriptor!.token);
    expect(redirect).toBe('https://www.getyourguide.com/activities/paris/?partner_id=phase2-test-partner');
  });

  it('rejects open redirects and malformed candidates', async () => {
    await expect(createGetYourGuideDescriptor({ candidate, targetUrl: 'https://evil.example/activity' })).resolves.toBeNull();
    await expect(createGetYourGuideDescriptor({ candidate, targetUrl: 'https://www.getyourguide.com/search?q=paris' })).resolves.toBeNull();
    await expect(createGetYourGuideDescriptor({ candidate: { ...candidate, name: 'Nearby' } })).resolves.toBeNull();
    await expect(createGetYourGuideDescriptor({ candidate, targetUrl: 'http://www.getyourguide.com/activity' })).resolves.toBeNull();
  });

  it('rejects an otherwise valid descriptor after its configured TTL', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-08-01T12:00:00.000Z');
    jest.setSystemTime(now);
    const descriptor = await createGetYourGuideDescriptor({ candidate });
    jest.setSystemTime(new Date(now.getTime() + 11 * 60 * 1000));
    await expect(resolveGetYourGuideRedirect(descriptor!.token)).resolves.toBeNull();
    jest.useRealTimers();
  });

  it('rejects tampered and expired tokens and fails closed when the flag is disabled', async () => {
    const descriptor = await createGetYourGuideDescriptor({ candidate });
    const tokenParts = descriptor!.token.split('.');
    // Change a significant byte in the authenticated tag rather than a
    // trailing Base64URL padding bit (which can decode to the same value).
    tokenParts[2] = `${tokenParts[2][0] === 'a' ? 'b' : 'a'}${tokenParts[2].slice(1)}`;
    const tampered = tokenParts.join('.');
    await expect(resolveGetYourGuideRedirect(tampered)).resolves.toBeNull();
    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: false });
    await expect(resolveGetYourGuideRedirect(descriptor!.token)).resolves.toBeNull();
  });

  it('supports Unicode activity names while keeping the token opaque', async () => {
    const descriptor = await createGetYourGuideDescriptor({ candidate: { ...candidate, name: 'Museo Nacional de Antropología — visita guiada' } });
    expect(descriptor).not.toBeNull();
    expect(descriptor!.token).not.toContain('Antropología');
  });
});

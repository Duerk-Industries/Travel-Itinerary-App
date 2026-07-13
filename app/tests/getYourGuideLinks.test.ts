/** @jest-environment node */
import {
  buildGetYourGuideCandidate,
  clearGetYourGuideDescriptorCache,
  formatGetYourGuideExportDisclosure,
  getGetYourGuideCtaLabel,
  isGetYourGuideDescriptor,
  isGetYourGuideActivityEligible,
  requestGetYourGuideDescriptor,
} from '../utils/getYourGuideLinks';

describe('GetYourGuide client descriptor consumer', () => {
  const descriptor = {
    provider: 'getyourguide' as const,
    kind: 'activity',
    token: 'g1.aaaaaaaa.aaaaaaaa.aaaaaaaa',
    disclosureRequired: true as const,
    expiresAt: '2099-01-01T00:00:00.000Z',
    rulesVersion: 'getyourguide-eligibility-v1',
  };

  const activity = {
    id: 'activity-1',
    name: 'Louvre Museum Guided Tour',
    activityType: 'Tour',
    date: '2026-09-02',
    startTime: '10:00',
    duration: '2 hours',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    clearGetYourGuideDescriptorCache();
  });

  it('validates only server-issued opaque descriptors', () => {
    expect(isGetYourGuideDescriptor(descriptor)).toBe(true);
    expect(isGetYourGuideDescriptor({ ...descriptor, token: 'https://www.getyourguide.com/' })).toBe(false);
    expect(isGetYourGuideDescriptor({ ...descriptor, expiresAt: '2000-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('mirrors eligibility without constructing a partner URL', () => {
    const candidate = buildGetYourGuideCandidate(activity, 'Paris, France');
    expect(candidate.durationMinutes).toBe(120);
    expect(isGetYourGuideActivityEligible(activity, 'Paris, France')).toBe(true);
    expect(isGetYourGuideActivityEligible({ ...activity, activityType: 'Shopping' }, 'Paris, France')).toBe(false);
    expect(getGetYourGuideCtaLabel('Eiffel Tower Tickets', 'Ticketed Attraction')).toBe('Get Skip-the-Line Tickets ↗');
    expect(getGetYourGuideCtaLabel('Louvre Museum Guided Tour')).toBe('Explore experiences on GetYourGuide ↗');
  });

  it('requests a descriptor asynchronously and hides malformed/offline responses', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => descriptor,
    } as Response);
    await expect(requestGetYourGuideDescriptor({
      backendUrl: 'https://wanderbunnies.test',
      headers: { Authorization: 'Bearer token' },
      activity,
      destination: 'Paris, France',
    })).resolves.toEqual(descriptor);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wanderbunnies.test/api/affiliate/getyourguide/descriptor',
      expect.objectContaining({ method: 'POST' }),
    );

    clearGetYourGuideDescriptorCache();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ bad: true }) } as Response);
    await expect(requestGetYourGuideDescriptor({
      backendUrl: 'https://wanderbunnies.test', activity, destination: 'Paris, France',
    })).resolves.toBeNull();
    await expect(requestGetYourGuideDescriptor({
      backendUrl: 'https://wanderbunnies.test', activity, destination: 'Paris, France', featureEnabled: false,
    })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('emits disclosure text only when an export has a valid descriptor', () => {
    expect(formatGetYourGuideExportDisclosure(descriptor)).toContain('Affiliate link');
    expect(formatGetYourGuideExportDisclosure(null)).toBe('');
  });
});

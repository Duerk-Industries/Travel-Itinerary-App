import path from 'path';
import { getApiLimitsConfig } from '../src/config/apiLimits';
import { loadCostModelConfig } from '../src/costModel';

describe('Phase 7 trip-blog governance', () => {
  // This test originally also asserted that these 9 flags ship `enabled: false` by default (a
  // "dark launch" contract). `40f0401` ("Updated default feature flags") intentionally turned
  // them on in production alongside the rest of the trip-blog feature set — confirmed, not a
  // config drift — so that assertion is gone; the rate-limit/caching governance below is still
  // real and still enforced regardless of these flags' values.
  it('caps every new server operation', () => {
    const config = getApiLimitsConfig();
    const callers = config.providers.TRIP_BLOG_SOCIAL_API.callers;
    for (const key of ['BLOG_DOCUMENT_READ', 'BLOG_AUTHORING_WRITE', 'BLOG_SEARCH_READ', 'BLOG_PLACES_READ', 'BLOG_QUICK_CAPTURE_HANDOFF']) expect(Number(callers[key])).toBeGreaterThan(0);
    expect(Number(config.providers.TRIP_BLOG_SOCIAL_CAPACITY.callers.TEXT_RETAINED_KIB)).toBeGreaterThan(0);
    expect(config.caching.TRIPBLOG).toEqual(expect.objectContaining({ SEARCHPAGESIZE: 20, SEARCHSCANMAXITEMS: 500, PLACESPAGESIZE: 100, PLACESREADUNITSFIREBASE: 2000, OFFLINEQUEUEMAXENTRIES: 25, OFFLINEQUEUERETENTIONDAYS: 7, AUDIOMAXBYTES: 26214400 }));
  });

  it('includes voice storage and zero-provider-cost local keepsakes in cost scenarios', () => {
    const config = loadCostModelConfig(path.resolve(__dirname, '../config/cost-model.yaml'));
    const source = config.costSources.find((candidate) => candidate.type === 'variable' && candidate.api === 'tripBlogSocial');
    const metrics = new Set(source?.type === 'variable' ? source.usageLevels.map((level) => level.metric) : []);
    expect(metrics.has('voice_note_gb_month')).toBe(true);
    expect(metrics.has('keepsake_exports')).toBe(true);
    expect(config.usagePerUser.Premium.tripBlogSocial.voice_note_gb_month).toBeGreaterThan(0);
  });
});

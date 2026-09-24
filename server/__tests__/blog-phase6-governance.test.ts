import path from 'path';
import { getApiLimitsConfig } from '../src/config/apiLimits';
import { loadCostModelConfig } from '../src/costModel';

describe('Phase 6 trip-blog governance configuration', () => {
  it('keeps every new operation family behind finite durable limits', () => {
    const config = getApiLimitsConfig();
    const api = config.providers.TRIP_BLOG_SOCIAL_API;
    const storage = config.providers.TRIP_BLOG_SOCIAL_STORAGE;
    const capacity = config.providers.TRIP_BLOG_SOCIAL_CAPACITY;
    for (const caller of ['BLOG_RECAP_READ', 'BLOG_RECAP_BUILD', 'BLOG_COVER_PROPOSAL_READ', 'BLOG_CAPTION_REQUEST', 'BLOG_PUBLICATION_READINESS_READ', 'BLOG_AUTHORING_WRITE']) {
      expect(api?.callers?.[caller]).toEqual(expect.any(Number));
      expect(Number(api?.callers?.[caller])).toBeGreaterThan(0);
    }
    expect(storage?.callers).toEqual(expect.objectContaining({ DATABASE_READ_UNIT: expect.any(Number), DATABASE_WRITE_UNIT: expect.any(Number), DATABASE_DELETE_UNIT: expect.any(Number) }));
    expect(capacity?.callers?.RECAP_RETAINED_KIB).toEqual(expect.any(Number));
    expect(config.caching.TRIPBLOG).toEqual(expect.objectContaining({ RECAPLEASESECONDS: 60, RECAPSNAPSHOTSPERTRIP: 3, RECAPGENERATIONSPERDAYPERTRIP: 5, CAPTIONSUGGESTIONSPERDAYPERUSER: 10, CAPTIONSUGGESTIONSPERMONTHPREMIUM: 100 }));
  });

  it('prices request, read, write, delete, retention, map, and caption-token dimensions', () => {
    const config = loadCostModelConfig(path.resolve(__dirname, '../config/cost-model.yaml'));
    const source = config.costSources.find((candidate) => candidate.type === 'variable' && candidate.api === 'tripBlogSocial');
    expect(source?.type).toBe('variable');
    const metrics = new Set(source?.type === 'variable' ? source.usageLevels.map((level) => level.metric) : []);
    for (const metric of ['cloud_run_requests', 'firestore_reads', 'firestore_writes', 'firestore_deletes', 'retained_kib_month', 'static_map_requests', 'ai_caption_input_tokens', 'ai_caption_output_tokens']) expect(metrics.has(metric)).toBe(true);
    expect(config.usagePerUser.Basic.tripBlogSocial).toBeDefined();
    expect(config.usagePerUser.Premium.tripBlogSocial.ai_caption_input_tokens).toBeGreaterThan(0);
  });
});

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getApiLimitsConfig } from '../src/config/apiLimits';
import { loadCostModelConfig } from '../src/costModel';

describe('Phase 7 trip-blog governance', () => {
  it('ships major components dark and caps every new server operation', () => {
    const flags = yaml.load(fs.readFileSync(path.resolve(__dirname, '../config/feature-flags.yaml'), 'utf8')) as any;
    for (const key of ['trip_blog_audio', 'trip_blog_audio_transcription', 'trip_blog_mobile_share_ios', 'trip_blog_mobile_share_android', 'trip_blog_search', 'trip_blog_places', 'trip_blog_offline_queue', 'trip_blog_trip_awards', 'trip_blog_keepsake_export']) {
      expect(flags.flags[key]?.enabled).toBe(false);
    }
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

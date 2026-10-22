import { createHash } from 'crypto';
import { z } from 'zod';
import { getEnvFlag, getEnvValue } from '../env';

// Operator-reviewed permissions, not permissions inferred from a provider name
// or from the existence of an API endpoint. No user/private address inputs.
const policySchema = z.object({
  revision: z.string().trim().min(1).max(80),
  termsUrl: z.string().url().refine(value => new URL(value).protocol === 'https:'),
  publicPoiInputs: z.literal(true),
  storage: z.literal(true),
  display: z.literal(true),
  export: z.literal(true),
  attribution: z.string().trim().min(1).max(500),
  positiveTtlSeconds: z.number().int().min(60).max(30 * 86400),
  negativeTtlSeconds: z.number().int().min(60).max(86400),
  minIntervalMs: z.number().int().min(15_000).max(3600_000),
  dailyRequestLimit: z.number().int().min(0).max(1000),
}).strict();

export const getGeocodingPolicy = () => {
  if (!getEnvFlag('GEOCODING_PUBLIC_POI_APPROVED')) return null;
  try {
    const endpoint = new URL(getEnvValue('GEOCODING_SEARCH_URL') || '');
    const identity = (getEnvValue('GEOCODING_USER_AGENT') || '').trim();
    const version = (getEnvValue('GEOCODING_PROVIDER_VERSION') || '').trim();
    const host = endpoint.hostname.toLowerCase().replace(/\.$/, '');
    if (endpoint.protocol !== 'https:' || /(^|\.)openstreetmap\.org$/.test(host)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || identity.length < 8 || identity.length > 256 || /[\r\n]/.test(identity)
      || !version || version.length > 80) return null;
    const policy = policySchema.parse(JSON.parse(getEnvValue('GEOCODING_POLICY_JSON') || 'null'));
    // Changing endpoint, permissions, attribution or retention retires old
    // cached data/jobs even if an operator forgets to bump the provider version.
    const fingerprint = createHash('sha256').update(JSON.stringify(['public-poi-nfkc-v1', endpoint.href, policy])).digest('hex');
    const configured = Number(getEnvValue('GEOCODING_MAX_DAILY_REQUESTS', { defaultValue: '100' }));
    const dailyLimit = Number.isFinite(configured) ? Math.max(0, Math.min(policy.dailyRequestLimit, Math.floor(configured))) : 0;
    return { endpoint: endpoint.href, identity, version: `${version}:${fingerprint}`, policy, dailyLimit };
  } catch { return null; }
};

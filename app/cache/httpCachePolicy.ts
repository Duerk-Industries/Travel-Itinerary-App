export type HttpCacheCategory = 'trip' | 'account' | 'blog' | 'imports' | 'reference' | 'sensitive';
export type HttpCachePolicy = { category: HttpCacheCategory; persist: boolean; staleTime: number; cachedView: boolean };
const sensitive: HttpCachePolicy = { category: 'sensitive', persist: false, staleTime: 0, cachedView: false };

/** Explicit API policy; unknown URLs and one-time/action endpoints always use the network. */
export const httpCachePolicy = (path: string): HttpCachePolicy | null => {
  if (!path.startsWith('/api/')) return null;
  if (/^\/api\/(auth|web-auth|internal|analytics)(\/|$)/.test(path) || /\/(stream|export|download|bundle|offline-snapshot|snapshot|receipt|receipt-url|signed-url|document-url|recap|status|jobs\/[^/]+)$/.test(path)) return null;
  // Packing already has a declarative query. Never nest another read cache underneath it.
  if (/\/packing-list(?:\/|$)/.test(path) || path === '/api/admin/packing-list-defaults') return null;
  if (/^\/api\/account(\/|$)/.test(path) && !/^\/api\/account\/(family|fellow-travelers|packing-list-presets)(\/|$)/.test(path)) return sensitive;
  if (/^\/api\/(admin|billing|plaid|notifications)(\/|$)/.test(path) ||
    /^\/api\/account(?:$|\/(emails|privacy|age|consent|subscription|devices|notifications|ingestion|gmail))/.test(path) ||
    /\/([a-z-]*capabilities|permissions|access|settings|config|follow-code|share-code|invites)(\/|$)/.test(path) ||
    /^\/api\/groups\/[^/]+\/members$/.test(path) || /^\/api\/trips\/[^/]+\/members$/.test(path) ||
    /\/(share|activity-sharing|publication|readiness|storage)(\/|$)/.test(path) ||
    /^\/api\/traits\/profile/.test(path)) return sensitive;
  if (/^\/api\/trip-templates\/trips\//.test(path)) return { category: 'trip', persist: true, staleTime: 0, cachedView: true };
  if (/^\/api\/(places|template-images|trip-templates)(\/|$)/.test(path) || /\/(locations|airports|presets|catalog)$/.test(path)) {
    return { category: 'reference', persist: true, staleTime: 60 * 60_000, cachedView: true };
  }
  if (/^\/api\/ingestion(\/|$)/.test(path)) {
    // Uploaded documents/review queues contain confirmation and financial details: memory only.
    return { category: 'imports', persist: false, staleTime: 0, cachedView: true };
  }
  if (/\/blog(?:\/|$)/.test(path)) return { category: 'blog', persist: true, staleTime: 0, cachedView: true };
  if (/^\/api\/(trips|groups|transfers|flights|lodgings|activities|car-rentals|expenses|payments|itineraries|itinerary|maps|affiliate)(\/|$)/.test(path)) {
    return { category: 'trip', persist: true, staleTime: 0, cachedView: true };
  }
  if (/^\/api\/(account|traits)(\/|$)/.test(path)) return { category: 'account', persist: true, staleTime: 0, cachedView: true };
  return null;
};

export const mutationCategories = (path: string): HttpCacheCategory[] => {
  if (/^\/api\/(auth|web-auth|internal)(\/|$)/.test(path)) return [];
  // POST is also used for read-only provider operations; these must not cancel trip reads.
  if (/\/(images\/batch|parse|parse-text|estimate|preview|dry-run|search|geocode|static)$/.test(path)) return [];
  if (/^\/api\/admin(\/|$)/.test(path)) return ['trip', 'account', 'blog', 'imports', 'reference', 'sensitive'];
  if (/^\/api\/trip-templates(\/|$)/.test(path)) return ['reference', 'trip'];
  if (/^\/api\/billing(\/|$)/.test(path)) return ['account', 'sensitive'];
  if (/^\/api\/(ingestion|plaid)(\/|$)/.test(path)) return ['imports', 'trip', 'sensitive'];
  if (/\/blog(?:\/|$)/.test(path)) return ['blog'];
  if (/^\/api\/notifications(\/|$)/.test(path)) return ['sensitive'];
  if (/^\/api\/(account|traits)(\/|$)/.test(path)) return ['account', 'trip', 'sensitive'];
  if (/^\/api\/(trips|groups|transfers|flights|lodgings|activities|car-rentals|expenses|payments|itineraries|itinerary)(\/|$)/.test(path)) return ['trip', 'blog', 'sensitive'];
  return [];
};

/** Validate list/page discriminators before a bad 200 response can replace a good saved view. */
export const validHttpPayload = (path: string, data: unknown): boolean => {
  if (data === null || typeof data !== 'object') return false;
  if (/^\/api\/(activities|lodgings|transfers|flights|car-rentals|expenses|payments|itineraries|trips|groups|traits)$/.test(path) ||
    /^\/api\/trips\/followed$/.test(path) || /^\/api\/account\/(family|fellow-travelers)$/.test(path) ||
    /^\/api\/itineraries\/[^/]+\/details$/.test(path)) return Array.isArray(data);
  const body = data as Record<string, unknown>;
  if (/^\/api\/trips\/[^/]+\/blog$/.test(path)) return Array.isArray(body.days);
  if (/^\/api\/ingestion\/review-items$/.test(path)) return Array.isArray(body.items);
  if (/^\/api\/ingestion\/jobs$/.test(path)) return Array.isArray(body.jobs);
  if (/^\/api\/ingestion\/assignment\/trips$/.test(path)) return Array.isArray(body.trips);
  if (/\/planning-map-points$/.test(path)) return Array.isArray(body.points);
  return true;
};
